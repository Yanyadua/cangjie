"""
Clustering planner for the Global Knowledge Network.

Takes generated tags and matches them against existing topic nodes
in the global graph to produce a clustering proposal.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from .llm_client import LLMClient
from .embedding_client import EmbeddingClient
from .vector_store import VectorStore
from .graph_store import GraphStore

logger = logging.getLogger(__name__)

_TOP_K = 3
_SIMILARITY_THRESHOLD = 0.8
_MERGE_THRESHOLD = 0.85
_PARTITION_MATCH_THRESHOLD = 0.72

_PARTITION_SUGGEST_SYSTEM_PROMPT = (
    "你是一个个人知识库的分区规划模块。\n\n"
    "你将收到一篇新文章的标题、摘要、主题标签，以及用户已有的分区列表。\n"
    "请判断这篇文章是否应该创建一个新分区。\n\n"
    "规则：\n"
    "1. 如果文章聚焦的领域已有分区覆盖，返回 match_existing=true\n"
    "2. 如果文章属于全新领域，建议创建新分区，返回分区名和描述\n"
    "3. 分区名应简洁（2-6字），描述应概括该分区关注的主题范围\n"
    "4. 不要与已有分区名重复\n\n"
    "输出严格 JSON：\n"
    '{"match_existing": false, "partition_name": "分区名", "description": "描述", "reason": "原因"}'
)

_CLUSTERING_SYSTEM_PROMPT = (
    "你是一个个人知识库的主题聚类规划模块。\n"
    "\n"
    "你将收到：\n"
    "1. 新文章的标题和摘要\n"
    "2. AI 生成的主题标签列表\n"
    "3. 每个标签在全局图谱中匹配到的已有 topic 节点（按相似度排序）\n"
    "4. 已有 topic 节点之间的现有关系\n"
    "\n"
    "请为每个标签决定操作：\n"
    "- MERGE：与已有 topic 合并（当语义高度一致时）\n"
    "- NEW：创建新 topic 节点（当没有足够相似的已有 topic 时）\n"
    "\n"
    "同时检测 topic 之间的关系，建议新增的 topic 间边。\n"
    "\n"
    "输出严格 JSON，不要输出 Markdown。\n"
    "\n"
    "JSON 格式：\n"
    "{\n"
    '  "tag_actions": [\n'
    "    {\n"
    '      "tag_name": "标签名",\n'
    '      "action": "MERGE" | "NEW",\n'
    '      "target_topic_id": "已有节点ID（仅MERGE时）",\n'
    '      "confidence": 0.0,\n'
    '      "reason": "决策原因"\n'
    "    }\n"
    "  ],\n"
    '  "new_topic_descriptions": {\n'
    '    "标签名": "新topic的描述"\n'
    "  },\n"
    '  "topic_edges": [\n'
    "    {\n"
    '      "source_tag": "标签名或已有topic名",\n'
    '      "target_tag": "标签名或已有topic名",\n'
    '      "relation_type": "related_to" | "contains" | "part_of",\n'
    '      "reason": "关系原因"\n'
    "    }\n"
    "  ]\n"
    "}"
)


class ClusteringPlanner:
    """Plan how to integrate a new article's tags into the global topic graph."""

    def __init__(
        self,
        llm: LLMClient,
        embedding: EmbeddingClient,
        vector_store: VectorStore,
        graph_store: GraphStore,
    ):
        self.llm = llm
        self.embedding = embedding
        self.vector_store = vector_store
        self.graph_store = graph_store

    async def match_partition(
        self,
        article_title: str,
        article_summary: str,
        tags: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """匹配文章到最合适的分区，或建议新分区。

        返回:
          {"action": "MATCH", "target_partition_id": ..., "score": ..., "candidates": [...]}
          {"action": "NEW", "proposed_name": ..., "proposed_description": ..., "reason": ...}
        """
        # Step 1: 摘要向量匹配
        summary_hits: list[dict] = []
        try:
            summary_emb = await self.embedding.embed(article_summary)
            summary_hits = await self.vector_store.search_nodes(
                query_embedding=summary_emb,
                top_k=3,
                node_type="partition",
            )
        except Exception as e:
            logger.warning(f"Partition summary match failed: {e}")

        # Step 2: 标签向量匹配
        tag_scores: dict[str, float] = {}
        for tag in tags:
            try:
                tag_emb = await self.embedding.embed(tag["name"])
                tag_hits = await self.vector_store.search_nodes(
                    query_embedding=tag_emb,
                    top_k=1,
                    node_type="partition",
                )
                for hit in tag_hits:
                    pid = hit["id"]
                    if pid not in tag_scores or hit["score"] > tag_scores[pid]:
                        tag_scores[pid] = hit["score"]
            except Exception as e:
                logger.warning(f"Tag partition match failed for '{tag['name']}': {e}")

        # Step 3: 综合评分
        summary_map = {hit["id"]: hit for hit in summary_hits}
        all_pids = set(summary_map.keys()) | set(tag_scores.keys())
        scored: list[dict] = []

        for pid in all_pids:
            s_score = summary_map.get(pid, {}).get("score", 0.0)
            t_score = tag_scores.get(pid, 0.0)
            combined = 0.6 * s_score + 0.4 * t_score
            node_info = summary_map.get(pid, {})
            scored.append({
                "id": pid,
                "name": node_info.get("name", ""),
                "description": node_info.get("description", ""),
                "score": round(combined, 4),
            })

        scored.sort(key=lambda x: x["score"], reverse=True)

        # Step 4: 决策
        if scored and scored[0]["score"] >= _PARTITION_MATCH_THRESHOLD:
            best = scored[0]
            return {
                "action": "MATCH",
                "target_partition_id": best["id"],
                "target_partition_name": best["name"],
                "score": best["score"],
                "candidates": [
                    {"id": c["id"], "name": c["name"], "score": c["score"]}
                    for c in scored[:3]
                ],
                "reason": f"摘要+标签综合相似度 {best['score']:.2f}",
            }

        # 未匹配 → LLM 建议新分区
        existing_names = [c["name"] for c in scored if c["name"]]
        suggestion = await self._suggest_new_partition(
            article_title, article_summary, tags, existing_names
        )
        suggestion["candidates"] = [
            {"id": c["id"], "name": c["name"], "score": c["score"]}
            for c in scored[:3]
        ]
        return suggestion

    async def _suggest_new_partition(
        self,
        article_title: str,
        article_summary: str,
        tags: list[dict[str, Any]],
        existing_partition_names: list[str],
    ) -> dict[str, Any]:
        """让 LLM 建议新分区名和描述。"""
        user_prompt = json.dumps({
            "article_title": article_title,
            "article_summary": article_summary,
            "topic_tags": [t["name"] for t in tags],
            "existing_partition_names": existing_partition_names,
        }, ensure_ascii=False, indent=2)

        try:
            raw = await self.llm.generate_json(
                _PARTITION_SUGGEST_SYSTEM_PROMPT, user_prompt
            )
            if raw.get("match_existing"):
                return {
                    "action": "NEW",
                    "proposed_name": "",
                    "proposed_description": "",
                    "reason": "LLM建议匹配已有但相似度不足，请手动选择",
                    "score": 0.0,
                }
            return {
                "action": "NEW",
                "proposed_name": raw.get("partition_name", ""),
                "proposed_description": raw.get("description", ""),
                "reason": raw.get("reason", "现有分区无强匹配"),
                "score": 0.0,
            }
        except Exception as e:
            logger.warning(f"Partition suggestion LLM call failed: {e}")
            return {
                "action": "NEW",
                "proposed_name": "",
                "proposed_description": "",
                "reason": "LLM调用失败，请手动输入分区名",
                "score": 0.0,
            }

    async def generate_proposal(
        self,
        article_title: str,
        article_summary: str,
        tags: list[dict[str, Any]],
        document_id: str,
    ) -> dict[str, Any]:
        # Step 1: For each tag, search for similar topic nodes
        tag_matches: dict[str, list[dict]] = {}
        for tag in tags:
            tag_name = tag["name"]
            try:
                tag_emb = await self.embedding.embed(tag_name)
                matches = await self.vector_store.search_nodes(
                    query_embedding=tag_emb,
                    top_k=_TOP_K,
                    node_type="topic",
                )
                tag_matches[tag_name] = [
                    m for m in matches if m["score"] >= _SIMILARITY_THRESHOLD
                ]
            except Exception as e:
                logger.warning(f"Vector search failed for tag '{tag_name}': {e}")
                tag_matches[tag_name] = []

        # Step 2: Get existing topic-topic edges for context
        all_topic_nodes = await self.graph_store.get_all_active_nodes()
        topic_ids = [n["id"] for n in all_topic_nodes if n["node_type"] == "topic"]
        existing_edges = []
        if topic_ids:
            from uuid import UUID
            topic_uuids = [UUID(tid) for tid in topic_ids]
            existing_edges = await self.graph_store.get_edges_for_nodes(topic_uuids)

        # Step 3: Build context for LLM
        tags_with_matches = []
        for tag in tags:
            name = tag["name"]
            matches = tag_matches.get(name, [])
            tags_with_matches.append({
                "name": name,
                "confidence": tag["confidence"],
                "matches": [
                    {
                        "id": m["id"],
                        "name": m["name"],
                        "description": m.get("description", ""),
                        "similarity": round(m["score"], 3),
                    }
                    for m in matches
                ],
            })

        existing_edges_info = [
            {
                "source": e["source"],
                "target": e["target"],
                "relation_type": e["relation_type"],
            }
            for e in existing_edges
            if e["relation_type"] in ("related_to", "contains", "part_of")
        ]

        user_prompt = json.dumps({
            "article_title": article_title,
            "article_summary": article_summary,
            "tags_with_matches": tags_with_matches,
            "existing_topic_edges": existing_edges_info,
        }, ensure_ascii=False, indent=2)

        # Step 4: Call LLM
        raw = await self.llm.generate_json(_CLUSTERING_SYSTEM_PROMPT, user_prompt)

        # Step 5: Build proposal
        return self._build_proposal(raw, tags, tag_matches, article_title, article_summary, document_id)

    def _build_proposal(
        self,
        llm_result: dict,
        tags: list[dict],
        tag_matches: dict[str, list[dict]],
        article_title: str,
        article_summary: str,
        document_id: str,
    ) -> dict[str, Any]:
        tag_actions = llm_result.get("tag_actions", [])
        new_topic_descriptions = llm_result.get("new_topic_descriptions", {})
        topic_edges = llm_result.get("topic_edges", [])

        validated_actions = []
        for action in tag_actions:
            tag_name = action.get("tag_name", "")
            act = action.get("action", "NEW").upper()
            confidence = action.get("confidence", 0.5)

            if act == "MERGE":
                target_id = action.get("target_topic_id", "")
                matches = tag_matches.get(tag_name, [])
                matched_names = [
                    {"id": m["id"], "name": m["name"], "similarity": m["score"]}
                    for m in matches
                ]
                validated_actions.append({
                    "tag_name": tag_name,
                    "action": "MERGE",
                    "target_topic_id": target_id,
                    "confidence": confidence,
                    "reason": action.get("reason", ""),
                    "matched_candidates": matched_names,
                })
            else:
                validated_actions.append({
                    "tag_name": tag_name,
                    "action": "NEW",
                    "target_topic_id": None,
                    "confidence": confidence,
                    "reason": action.get("reason", ""),
                    "proposed_description": new_topic_descriptions.get(tag_name, ""),
                    "temp_id": f"t_{uuid4().hex[:8]}",
                })

        # Add tags not covered by LLM (fallback)
        covered_tags = {a["tag_name"] for a in validated_actions}
        for tag in tags:
            if tag["name"] not in covered_tags:
                matches = tag_matches.get(tag["name"], [])
                if matches and matches[0]["score"] >= _MERGE_THRESHOLD:
                    validated_actions.append({
                        "tag_name": tag["name"],
                        "action": "MERGE",
                        "target_topic_id": matches[0]["id"],
                        "confidence": matches[0]["score"],
                        "reason": f"语义相似度 {matches[0]['score']:.2f}，自动建议合并",
                        "matched_candidates": [
                            {"id": m["id"], "name": m["name"], "similarity": m["score"]}
                            for m in matches
                        ],
                    })
                else:
                    validated_actions.append({
                        "tag_name": tag["name"],
                        "action": "NEW",
                        "target_topic_id": None,
                        "confidence": tag["confidence"],
                        "reason": "未找到足够相似的已有topic",
                        "proposed_description": "",
                        "temp_id": f"t_{uuid4().hex[:8]}",
                    })

        return {
            "article_title": article_title,
            "article_summary": article_summary,
            "document_id": document_id,
            "tag_actions": validated_actions,
            "topic_edges": topic_edges,
        }
