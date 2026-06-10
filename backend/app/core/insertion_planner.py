"""
Insertion planner for the Personal Knowledge Base.

Given a draft graph extracted from a new article, the planner:

1. Constructs an insertion query from the article summary, core concepts and
   claims.
2. Embeds the query and searches the vector store for similar nodes/chunks.
3. Expands matched nodes by one hop in the graph store.
4. Calls the LLM to generate an insertion proposal with candidate positions,
   suggested merges, suggested edges, and possible conflicts.
"""

from __future__ import annotations

import json
import logging
import re
from uuid import UUID
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

_TOP_K = 10

_PLANNER_SYSTEM_PROMPT = (
    "你是一个个人知识库系统的图谱插入规划模块。\n"
    "\n"
    "你将收到以下信息：\n"
    "1. 新文章的草稿图谱（包含 summary, nodes, edges）\n"
    "2. 在全局图谱中检索到的相关已有节点及其 1-hop 邻居\n"
    "3. 实体消歧的匹配建议\n"
    "\n"
    "请根据这些信息，生成一份图谱插入提案（JSON 格式），包含：\n"
    "- candidate_positions：新文章节点应该连接到全局图谱的哪些位置\n"
    "- suggested_merges：草稿节点与已有节点应合并的建议\n"
    "- suggested_edges：建议在全局图谱中新增的边\n"
    "- possible_conflicts：可能冲突的信息（如矛盾的观点）\n"
    "\n"
    "输出严格 JSON，不要输出 Markdown，不要输出解释文字。\n"
    "\n"
    "JSON 格式：\n"
    "{\n"
    '  "candidate_positions": [\n'
    "    {\n"
    '      "target_node_id": "已有节点ID",\n'
    '      "target_node_name": "已有节点名称",\n'
    '      "reason": "连接原因",\n'
    '      "score": 0.0\n'
    "    }\n"
    "  ],\n"
    '  "suggested_merges": [\n'
    "    {\n"
    '      "draft_node_temp_id": "草稿节点temp_id",\n'
    '      "existing_node_id": "已有节点ID",\n'
    '      "reason": "合并原因",\n'
    '      "confidence": 0.0\n'
    "    }\n"
    "  ],\n"
    '  "suggested_edges": [\n'
    "    {\n"
    '      "source": "节点ID或temp_id",\n'
    '      "target": "节点ID或temp_id",\n'
    '      "relation_type": "关系类型",\n'
    '      "reason": "建议原因",\n'
    '      "confidence": 0.0\n'
    "    }\n"
    "  ],\n"
    '  "possible_conflicts": [\n'
    "    {\n"
    '      "description": "冲突描述",\n'
    '      "involved_nodes": ["节点ID"],\n'
    '      "resolution_hint": "建议处理方式"\n'
    "    }\n"
    "  ]\n"
    "}"
)


def _strip_json_markdown(text: str) -> str:
    """Remove ```json ... ``` wrapping if the LLM wrapped its output."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _build_insertion_query(draft_graph: dict) -> str:
    """Construct a semantic query from the draft graph for vector search."""

    parts: list[str] = []

    summary = draft_graph.get("summary", "")
    if summary:
        parts.append(summary)

    for node in draft_graph.get("nodes", []):
        node_type = node.get("node_type", "")
        name = node.get("name", "")
        if node_type in ("concept", "claim", "topic", "technology", "method", "question"):
            parts.append(name)

    return "\n".join(parts) if parts else ""


def _expand_one_hop(
    matched_node_ids: list[str],
    graph_store: Any,
) -> dict:
    """Retrieve 1-hop neighbors for each matched node via graph_store.

    Returns a dict mapping each matched node id to its neighbor info.
    """

    context: dict[str, Any] = {}
    for node_id in matched_node_ids:
        try:
            neighbors = graph_store.get_one_hop_neighbors(node_id)
            context[node_id] = neighbors
        except Exception:
            logger.warning("Failed to expand 1-hop neighbors for node %s", node_id)
            context[node_id] = {"nodes": [], "edges": []}
    return context


class InsertionPlanner:
    """Plan where and how a new article's draft graph integrates into the global graph."""

    def __init__(self, llm_client: LLMClient) -> None:
        self._llm = llm_client

    async def plan(
        self,
        document_id: UUID,
        draft_graph: dict,
        graph_store: Any,
        vector_store: Any,
        embedding_client: Any,
        llm_client: LLMClient,
    ) -> dict:
        """Generate an insertion proposal for *draft_graph*.

        Parameters
        ----------
        document_id:
            UUID of the source document.
        draft_graph:
            Draft graph dict with ``summary``, ``nodes``, ``edges``.
        graph_store:
            Store with ``get_one_hop_neighbors(node_id)`` method.
        vector_store:
            Store with ``search(embedding, top_k)`` method.
        embedding_client:
            Client with ``embed(texts) -> list[list[float]]``.
        llm_client:
            LLM client (kept for backward-compat; the planner uses
            ``self._llm`` internally).

        Returns
        -------
        dict
            Insertion proposal with keys ``candidate_positions``,
            ``suggested_merges``, ``suggested_edges``, ``possible_conflicts``.
        """

        # ── Step 1: Build insertion query ──
        query = _build_insertion_query(draft_graph)
        if not query:
            logger.warning("Empty insertion query for document %s", document_id)
            return self._empty_proposal()

        # ── Step 2: Embed and search vector store ──
        try:
            if hasattr(embedding_client, "embed_batch"):
                embeddings = await embedding_client.embed_batch([query])
                query_embedding = embeddings[0]
            else:
                query_embedding = await embedding_client.embed(query)
        except Exception:
            logger.exception("Failed to embed insertion query for document %s", document_id)
            return self._empty_proposal()

        try:
            search_results = await vector_store.search(
                embedding=query_embedding,
                top_k=_TOP_K,
            )
        except Exception:
            logger.exception("Vector store search failed for document %s", document_id)
            return self._empty_proposal()

        # Collect matched node ids from search results
        matched_node_ids: list[str] = []
        for result in search_results:
            node_id = result.get("node_id") or result.get("id")
            if node_id:
                matched_node_ids.append(str(node_id))

        # ── Step 3: Expand 1-hop neighbors ──
        neighbor_context = _expand_one_hop(matched_node_ids, graph_store)

        # ── Step 4: Call LLM to generate insertion proposal ──
        user_prompt = json.dumps(
            {
                "document_id": str(document_id),
                "draft_graph": draft_graph,
                "matched_nodes": matched_node_ids,
                "neighbor_context": neighbor_context,
            },
            ensure_ascii=False,
            indent=2,
        )

        try:
            raw_response = await self._llm.generate_json(
                system_prompt=_PLANNER_SYSTEM_PROMPT,
                user_prompt=user_prompt,
            )
        except Exception:
            logger.exception("LLM insertion planning failed for document %s", document_id)
            return self._empty_proposal()

        # Parse response
        if isinstance(raw_response, str):
            raw_text = _strip_json_markdown(raw_response)
            try:
                proposal = json.loads(raw_text)
            except json.JSONDecodeError:
                logger.error("LLM returned invalid JSON for insertion proposal")
                return self._empty_proposal()
        elif isinstance(raw_response, dict):
            proposal = raw_response
        else:
            logger.error("Unexpected LLM response type: %s", type(raw_response))
            return self._empty_proposal()

        # Sanitize and ensure required keys
        return self._normalize_proposal(proposal)

    # ── Helpers ──

    @staticmethod
    def _empty_proposal() -> dict:
        return {
            "candidate_positions": [],
            "suggested_merges": [],
            "suggested_edges": [],
            "possible_conflicts": [],
        }

    @staticmethod
    def _normalize_proposal(proposal: dict) -> dict:
        """Ensure the proposal has all required keys with proper defaults."""

        return {
            "candidate_positions": proposal.get("candidate_positions") or [],
            "suggested_merges": proposal.get("suggested_merges") or [],
            "suggested_edges": proposal.get("suggested_edges") or [],
            "possible_conflicts": proposal.get("possible_conflicts") or [],
        }
