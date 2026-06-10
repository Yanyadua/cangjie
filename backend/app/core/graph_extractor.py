"""
Extract a local knowledge graph from an article by calling an LLM.

The extractor sends the article title and content to the LLM with a structured
system prompt, parses the JSON response, and validates all node/edge types
against the project whitelist.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

# ── Whitelists ──

VALID_NODE_TYPES = frozenset({
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology", "question",
})

VALID_RELATION_TYPES = frozenset({
    "related_to", "contains", "part_of", "supports", "contradicts",
    "depends_on", "implements", "improves", "causes", "compares_with",
    "derived_from", "used_for", "evidence_for", "mentions", "similar_to",
    "belongs_to",
})

REQUIRED_NODE_FIELDS = {"temp_id", "node_type", "name", "description"}
REQUIRED_EDGE_FIELDS = {"temp_id", "source", "target", "relation_type", "confidence", "evidence"}

# ── System prompt ──

_SYSTEM_PROMPT = (
    "你是一个个人知识库系统的信息抽取模块。你的任务是把用户提供的一篇文章转化成局部知识图谱。\n"
    "\n"
    "你需要抽取文章中的核心概念、实体、工具、方法、问题和明确观点。"
    "不要抽取过于泛化的词，例如\"系统\"\"数据\"\"用户\"\"平台\"\"模型\"，"
    "除非它们在文章中具有明确技术含义。\n"
    "\n"
    "你需要输出严格 JSON，不要输出 Markdown，不要输出解释文字。\n"
    "\n"
    "节点类型只能使用：\n"
    "article, concept, claim, topic, person, organization, paper, project, "
    "framework, tool, method, technology, question\n"
    "\n"
    "关系类型只能使用：\n"
    "related_to, contains, part_of, supports, contradicts, depends_on, "
    "implements, improves, causes, compares_with, derived_from, used_for, "
    "evidence_for, mentions, similar_to, belongs_to\n"
    "\n"
    "每个关系必须有 evidence。evidence 可以是文章中的证据句，也可以是忠实于原文的简短证据摘要。\n"
    "\n"
    "输出 JSON 格式：\n"
    "{\n"
    '  "summary": "文章摘要",\n'
    '  "nodes": [\n'
    "    {\n"
    '      "temp_id": "n1",\n'
    '      "node_type": "article | concept | claim | topic | person | organization | paper | project | framework | tool | method | technology | question",\n'
    '      "name": "节点名称",\n'
    '      "description": "节点解释"\n'
    "    }\n"
    "  ],\n"
    '  "edges": [\n'
    "    {\n"
    '      "temp_id": "e1",\n'
    '      "source": "n1",\n'
    '      "target": "n2",\n'
    '      "relation_type": "关系类型",\n'
    '      "confidence": 0.0,\n'
    '      "evidence": "证据"\n'
    "    }\n"
    "  ]\n"
    "}"
)

_USER_PROMPT_TEMPLATE = (
    "文章标题：{title}\n"
    "\n"
    "文章内容：\n"
    "{content}"
)


def _strip_json_markdown(text: str) -> str:
    """Remove ```json ... ``` wrapping if the LLM wrapped its output."""
    text = text.strip()
    if text.startswith("```"):
        # Remove opening ```json or ```
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        # Remove closing ```
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _validate_and_sanitize(raw: dict) -> dict:
    """Validate LLM output against whitelists, sanitizing where possible."""

    errors: list[str] = []

    # ── Top-level fields ──
    summary = raw.get("summary", "")
    if not isinstance(summary, str):
        summary = str(summary)

    raw_nodes = raw.get("nodes", [])
    raw_edges = raw.get("edges", [])

    if not isinstance(raw_nodes, list):
        errors.append("'nodes' is not a list")
        raw_nodes = []
    if not isinstance(raw_edges, list):
        errors.append("'edges' is not a list")
        raw_edges = []

    # ── Validate nodes ──
    valid_temp_ids: set[str] = set()
    clean_nodes: list[dict[str, Any]] = []

    for idx, node in enumerate(raw_nodes):
        if not isinstance(node, dict):
            errors.append(f"nodes[{idx}] is not a dict, skipped")
            continue

        missing = REQUIRED_NODE_FIELDS - set(node.keys())
        if missing:
            errors.append(f"nodes[{idx}] missing fields: {missing}")
            continue

        node_type = node["node_type"]
        if node_type not in VALID_NODE_TYPES:
            errors.append(
                f"nodes[{idx}] has invalid node_type '{node_type}', skipped"
            )
            continue

        temp_id = str(node["temp_id"])
        valid_temp_ids.add(temp_id)
        clean_nodes.append({
            "temp_id": temp_id,
            "node_type": node_type,
            "name": str(node["name"]),
            "description": str(node["description"]),
        })

    # ── Validate edges ──
    clean_edges: list[dict[str, Any]] = []
    seen_edge_keys: set[tuple[str, str, str]] = set()

    for idx, edge in enumerate(raw_edges):
        if not isinstance(edge, dict):
            errors.append(f"edges[{idx}] is not a dict, skipped")
            continue

        missing = REQUIRED_EDGE_FIELDS - set(edge.keys())
        if missing:
            errors.append(f"edges[{idx}] missing fields: {missing}")
            continue

        source = str(edge["source"])
        target = str(edge["target"])
        relation_type = edge["relation_type"]

        # Replace unknown relation_type with related_to
        if relation_type not in VALID_RELATION_TYPES:
            logger.warning(
                "edges[%d] has invalid relation_type '%s', replaced with 'related_to'",
                idx,
                relation_type,
            )
            relation_type = "related_to"

        # Validate temp_id references
        if source not in valid_temp_ids:
            errors.append(f"edges[{idx}] source '{source}' not found in nodes, skipped")
            continue
        if target not in valid_temp_ids:
            errors.append(f"edges[{idx}] target '{target}' not found in nodes, skipped")
            continue

        # Self-loop check
        if source == target:
            errors.append(f"edges[{idx}] self-loop on '{source}', skipped")
            continue

        # Duplicate edge check
        edge_key = (source, target, relation_type)
        if edge_key in seen_edge_keys:
            errors.append(f"edges[{idx}] duplicate edge {edge_key}, skipped")
            continue
        seen_edge_keys.add(edge_key)

        # Confidence bounds
        confidence = float(edge["confidence"])
        if confidence < 0.0:
            confidence = 0.0
        elif confidence > 1.0:
            confidence = 1.0

        # Evidence must not be empty
        evidence = str(edge["evidence"]).strip()
        if not evidence:
            evidence = "(no evidence provided)"

        clean_edges.append({
            "temp_id": str(edge["temp_id"]),
            "source": source,
            "target": target,
            "relation_type": relation_type,
            "confidence": confidence,
            "evidence": evidence,
        })

    if errors:
        logger.warning(
            "Graph extraction validation produced %d warning(s): %s",
            len(errors),
            "; ".join(errors),
        )

    return {
        "summary": summary,
        "nodes": clean_nodes,
        "edges": clean_edges,
    }


class GraphExtractor:
    """Extract a draft local knowledge graph from an article via LLM."""

    def __init__(self, llm_client: LLMClient) -> None:
        self._llm = llm_client

    async def extract(self, title: str, content: str) -> dict:
        """Call the LLM to extract a draft local graph from *title* + *content*.

        Returns a validated dict with keys ``summary``, ``nodes``, ``edges``.
        """

        user_prompt = _USER_PROMPT_TEMPLATE.format(
            title=title,
            content=content,
        )

        raw_response = await self._llm.generate_json(
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )

        # The LLM client may return a dict directly, or a string to parse.
        if isinstance(raw_response, str):
            raw_text = _strip_json_markdown(raw_response)
            try:
                raw = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                logger.error("LLM returned invalid JSON: %s", exc)
                return {"summary": "", "nodes": [], "edges": []}
        elif isinstance(raw_response, dict):
            raw = raw_response
        else:
            logger.error("Unexpected LLM response type: %s", type(raw_response))
            return {"summary": "", "nodes": [], "edges": []}

        return _validate_and_sanitize(raw)
