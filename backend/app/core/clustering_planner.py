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
