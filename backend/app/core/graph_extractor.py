"""
Multi-stage knowledge graph extraction with few-shot examples.

Pipeline:
  Stage 1: Summary + core concept identification
  Stage 2: Entity & claim extraction (guided by stage 1 concepts)
  Stage 3: Relationship extraction (guided by stage 2 nodes)
  Stage 4: Evidence cross-validation against source text

Each stage has a focused, single-responsibility prompt to maximise LLM output quality.
"""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher
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

# ── Few-shot example ──

_FEWSHOT_INPUT = """文章标题：GraphRAG：基于知识图谱的检索增强生成

文章内容：
GraphRAG 是微软研究院提出的一种基于知识图谱的检索增强生成方法。传统 RAG 系统通过向量相似度检索文档片段，但在需要跨文档推理或全局理解时表现不佳。GraphRAG 的核心思路是先将文档集合转化为知识图谱，然后利用社区检测算法将图谱划分为多个局部子图，再为每个社区生成摘要。查询时，系统通过遍历图谱和社区摘要来生成更全面的回答。社区检测是 GraphRAG 的关键步骤，通常使用 Leiden 算法。实验表明，GraphRAG 在需要全局理解的数据集上显著优于传统 RAG 方法。"""

_FEWSHOT_STAGE1_OUTPUT = json.dumps({
    "summary": "本文介绍了微软研究院提出的 GraphRAG 方法，通过知识图谱和社区检测改进传统 RAG 的全局推理能力。",
    "core_concepts": [
        {"name": "GraphRAG", "type": "method", "description": "微软研究院提出的基于知识图谱的检索增强生成方法"},
        {"name": "知识图谱", "type": "concept", "description": "GraphRAG 的基础数据结构，用于组织文档知识"},
        {"name": "社区检测", "type": "method", "description": "将知识图谱划分为局部子图的算法"},
        {"name": "Leiden 算法", "type": "method", "description": "GraphRAG 中使用的社区检测算法"},
        {"name": "传统 RAG", "type": "concept", "description": "基于向量相似度的检索增强生成方法"}
    ]
}, ensure_ascii=False, indent=2)

_FEWSHOT_STAGE2_OUTPUT = json.dumps({
    "nodes": [
        {"temp_id": "n1", "node_type": "article", "name": "GraphRAG：基于知识图谱的检索增强生成", "description": "文章整体节点"},
        {"temp_id": "n2", "node_type": "method", "name": "GraphRAG", "description": "微软研究院提出的基于知识图谱的检索增强生成方法"},
        {"temp_id": "n3", "node_type": "concept", "name": "知识图谱", "description": "GraphRAG 的基础数据结构，用于组织文档知识"},
        {"temp_id": "n4", "node_type": "method", "name": "社区检测", "description": "将知识图谱划分为局部子图的算法"},
        {"temp_id": "n5", "node_type": "method", "name": "Leiden 算法", "description": "GraphRAG 中使用的社区检测算法"},
        {"temp_id": "n6", "node_type": "concept", "name": "传统 RAG", "description": "基于向量相似度的检索增强生成方法，GraphRAG 的改进对象"},
        {"temp_id": "n7", "node_type": "organization", "name": "微软研究院", "description": "提出 GraphRAG 的研究机构"},
        {"temp_id": "n8", "node_type": "claim", "name": "GraphRAG 在全局理解任务上优于传统 RAG", "description": "实验表明 GraphRAG 在需要全局理解的数据集上显著优于传统 RAG"}
    ]
}, ensure_ascii=False, indent=2)

_FEWSHOT_STAGE3_OUTPUT = json.dumps({
    "edges": [
        {"temp_id": "e1", "source": "n1", "target": "n2", "relation_type": "mentions", "confidence": 1.0, "evidence": "GraphRAG 是微软研究院提出的一种基于知识图谱的检索增强生成方法"},
        {"temp_id": "e2", "source": "n2", "target": "n3", "relation_type": "depends_on", "confidence": 0.95, "evidence": "GraphRAG 的核心思路是先将文档集合转化为知识图谱"},
        {"temp_id": "e3", "source": "n2", "target": "n4", "relation_type": "depends_on", "confidence": 0.9, "evidence": "利用社区检测算法将图谱划分为多个局部子图"},
        {"temp_id": "e4", "source": "n4", "target": "n5", "relation_type": "implements", "confidence": 0.9, "evidence": "社区检测是 GraphRAG 的关键步骤，通常使用 Leiden 算法"},
        {"temp_id": "e5", "source": "n2", "target": "n6", "relation_type": "improves", "confidence": 0.95, "evidence": "GraphRAG 在需要全局理解的数据集上显著优于传统 RAG 方法"},
        {"temp_id": "e6", "source": "n2", "target": "n7", "relation_type": "belongs_to", "confidence": 1.0, "evidence": "GraphRAG 是微软研究院提出的"},
        {"temp_id": "e7", "source": "n8", "target": "n2", "relation_type": "supports", "confidence": 0.9, "evidence": "实验表明，GraphRAG 在需要全局理解的数据集上显著优于传统 RAG 方法"}
    ]
}, ensure_ascii=False, indent=2)

# ── Relation type guidance ──

_RELATION_GUIDANCE = """
关系类型选择指南（请严格按以下语义选择）：

- contains: A 包含 B 作为组成部分（如：评估体系→轨迹评估）
- part_of: contains 的反向（B 是 A 的一部分）
- supports: A 提供论据支持 B 的观点
- contradicts: A 与 B 存在矛盾或反对
- depends_on: A 的实现或成立依赖于 B
- implements: A 是 B 理念/方法的具体实现
- improves: A 是对 B 的改进或增强
- causes: A 导致了 B
- compares_with: A 与 B 进行比较
- derived_from: A 从 B 衍生而来
- used_for: A 被用于实现 B
- evidence_for: A 是 B 的证据
- mentions: A 提及 B（通用关联）
- similar_to: A 与 B 相似
- belongs_to: A 属于 B（如：方法属于某个组织）
- related_to: 以上均不适用时的兜底类型
"""

# ── Stage prompts ──

_STAGE1_SYSTEM = (
    "你是一个知识抽取模块。你的任务是分析文章并输出摘要和核心概念。\n\n"
    "要求：\n"
    "1. 摘要要简洁（1-3句话），概括文章核心内容\n"
    "2. 提取文章中的核心概念、实体、方法、工具等，不要提取泛化词（如\"系统\"\"数据\"\"用户\"）\n"
    "3. 每个概念给出合适的类型和简短描述\n"
    "4. 输出严格 JSON，不要输出 Markdown\n\n"
    "节点类型：article, concept, claim, topic, person, organization, paper, project, "
    "framework, tool, method, technology, question\n\n"
    "示例：\n"
    f"输入：{_FEWSHOT_INPUT}\n"
    f"输出：{_FEWSHOT_STAGE1_OUTPUT}"
)

_STAGE2_SYSTEM = (
    "你是一个知识抽取模块。基于文章内容和已识别的核心概念，抽取所有重要的实体节点和观点节点。\n\n"
    "要求：\n"
    "1. 首先创建一个 article 类型节点代表文章整体\n"
    "2. 将阶段1识别的核心概念转化为正式节点（补充 temp_id）\n"
    "3. 补充文章中提到的具体人物、组织、论文、项目等实体\n"
    "4. 提取文章中的明确观点（claim 类型）\n"
    "5. 不要重复阶段1已有的概念，但要确保它们的描述更完整\n"
    "6. 输出严格 JSON，不要输出 Markdown\n"
    "7. node_type 必须是以下之一，不能使用其他类型：\n"
    "   article, concept, claim, topic, person, organization, paper, project, "
    "framework, tool, method, technology, question\n"
    "   注意：benchmark/指标/维度 请用 concept 或 method 代替\n\n"
    "示例（基于上一阶段的概念）：\n"
    f"输出：{_FEWSHOT_STAGE2_OUTPUT}"
)

_STAGE3_SYSTEM = (
    "你是一个知识关系抽取模块。基于文章内容和已识别的节点，抽取节点之间的关系。\n\n"
    + _RELATION_GUIDANCE +
    "\n要求：\n"
    "1. 每条关系必须有 evidence，evidence 尽量引用原文中的句子\n"
    "2. confidence 反映你对这条关系的确信程度（0-1）\n"
    "3. 不要创建自环（source 和 target 不能相同）\n"
    "4. 不要创建重复关系\n"
    "5. 输出严格 JSON，不要输出 Markdown\n\n"
    "示例：\n"
    f"输出：{_FEWSHOT_STAGE3_OUTPUT}"
)

_STAGE4_SYSTEM = (
    "你是一个证据校验模块。你的任务是检查每条关系的 evidence 是否忠实于原文。\n\n"
    "对每条关系：\n"
    "1. 检查 evidence 是否可以在原文中找到对应内容\n"
    "2. 如果 evidence 是原文原句或忠实概括，标记为 \"valid\"\n"
    "3. 如果 evidence 与原文不符或过度推断，标记为 \"weak\" 并给出修正建议\n\n"
    "输出 JSON 格式：\n"
    '{\n  "results": [\n    {"edge_id": "e1", "status": "valid|weak", "correction": "修正后的evidence或null"}\n  ]\n}'
)


# ── Helpers ──

def _strip_json_markdown(text: str) -> str:
    """Remove ```json ... ``` wrapping if the LLM wrapped its output."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _parse_json_response(raw_response: Any) -> dict | None:
    """Parse LLM response into dict, handling both string and dict returns."""
    if isinstance(raw_response, dict):
        return raw_response
    if isinstance(raw_response, str):
        raw_text = _strip_json_markdown(raw_response)
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            logger.error("LLM returned invalid JSON: %s", exc)
            return None
    logger.error("Unexpected LLM response type: %s", type(raw_response))
    return None


def _text_similarity(a: str, b: str) -> float:
    """Quick string similarity for evidence validation."""
    return SequenceMatcher(None, a[:200], b[:200]).ratio()


def _validate_and_sanitize(raw: dict) -> dict:
    """Validate LLM output against whitelists, sanitizing where possible."""

    errors: list[str] = []

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
            errors.append(f"nodes[{idx}] has invalid node_type '{node_type}', skipped")
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

        if relation_type not in VALID_RELATION_TYPES:
            logger.warning("edges[%d] has invalid relation_type '%s', replaced with 'related_to'", idx, relation_type)
            relation_type = "related_to"

        if source not in valid_temp_ids:
            errors.append(f"edges[{idx}] source '{source}' not found in nodes, skipped")
            continue
        if target not in valid_temp_ids:
            errors.append(f"edges[{idx}] target '{target}' not found in nodes, skipped")
            continue

        if source == target:
            errors.append(f"edges[{idx}] self-loop on '{source}', skipped")
            continue

        edge_key = (source, target, relation_type)
        if edge_key in seen_edge_keys:
            errors.append(f"edges[{idx}] duplicate edge {edge_key}, skipped")
            continue
        seen_edge_keys.add(edge_key)

        confidence = float(edge["confidence"])
        confidence = max(0.0, min(1.0, confidence))

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
        logger.warning("Graph extraction validation produced %d warning(s): %s", len(errors), "; ".join(errors))

    return {
        "summary": summary,
        "nodes": clean_nodes,
        "edges": clean_edges,
    }


# ── Confidence calibration ──

def _calibrate_confidence(edges: list[dict], source_text: str) -> list[dict]:
    """Post-calibrate confidence based on evidence quality."""
    for edge in edges:
        evidence = edge.get("evidence", "")
        adjustment = 0.0

        # Evidence is a direct quote from source → boost
        if evidence and _text_similarity(evidence, source_text) > 0.5:
            adjustment += 0.05

        # Evidence is empty or generic → cap
        if not evidence or evidence == "(no evidence provided)":
            edge["confidence"] = min(edge.get("confidence", 0.5), 0.3)
            continue

        edge["confidence"] = max(0.0, min(1.0, edge.get("confidence", 0.5) + adjustment))

    return edges


# ── Main extractor ──

class GraphExtractor:
    """Multi-stage knowledge graph extractor with few-shot guidance."""

    def __init__(self, llm_client: LLMClient) -> None:
        self._llm = llm_client

    async def extract(self, title: str, content: str) -> dict:
        """Extract a draft local graph via 4-stage pipeline.

        Returns a validated dict with keys ``summary``, ``nodes``, ``edges``.
        Falls back to single-stage extraction on failure.
        """
        try:
            return await self._extract_multistage(title, content)
        except Exception:
            logger.exception("Multi-stage extraction failed, falling back to single-stage")
            return await self._extract_singlestage(title, content)

    async def _extract_multistage(self, title: str, content: str) -> dict:
        """4-stage extraction pipeline."""

        article_prompt = f"文章标题：{title}\n\n文章内容：\n{content}"

        # ── Stage 1: Summary + core concepts ──
        logger.info("Stage 1/4: Extracting summary and core concepts")
        stage1_raw = await self._llm.generate_json(
            system_prompt=_STAGE1_SYSTEM,
            user_prompt=article_prompt,
        )
        stage1 = _parse_json_response(stage1_raw)
        if not stage1:
            raise ValueError("Stage 1 returned invalid response")

        summary = stage1.get("summary", "")
        core_concepts = stage1.get("core_concepts", [])

        logger.info("Stage 1 complete: summary=%s, concepts=%d", summary[:50], len(core_concepts))

        # ── Stage 2: Entity & claim extraction ──
        logger.info("Stage 2/4: Extracting entities and claims")
        stage2_prompt = (
            f"文章标题：{title}\n\n文章内容：\n{content}\n\n"
            f"阶段1已识别的核心概念：\n{json.dumps(core_concepts, ensure_ascii=False, indent=2)}\n\n"
            "请基于以上概念，输出完整的节点列表（包含 article 节点、概念节点、实体节点和观点节点）。"
        )
        stage2_raw = await self._llm.generate_json(
            system_prompt=_STAGE2_SYSTEM,
            user_prompt=stage2_prompt,
        )
        stage2 = _parse_json_response(stage2_raw)
        if not stage2 or not stage2.get("nodes"):
            raise ValueError("Stage 2 returned no nodes")

        nodes = stage2["nodes"]
        logger.info("Stage 2 complete: %d nodes", len(nodes))

        # ── Stage 3: Relationship extraction ──
        logger.info("Stage 3/4: Extracting relationships")
        stage3_prompt = (
            f"文章内容：\n{content}\n\n"
            f"已识别的节点：\n{json.dumps(nodes, ensure_ascii=False, indent=2)}\n\n"
            "请基于文章内容，抽取这些节点之间的关系。"
        )
        stage3_raw = await self._llm.generate_json(
            system_prompt=_STAGE3_SYSTEM,
            user_prompt=stage3_prompt,
        )
        stage3 = _parse_json_response(stage3_raw)
        if not stage3:
            raise ValueError("Stage 3 returned invalid response")

        edges = stage3.get("edges", [])
        logger.info("Stage 3 complete: %d edges", len(edges))

        # ── Stage 4: Evidence cross-validation ──
        logger.info("Stage 4/4: Cross-validating evidence")
        await self._validate_evidence(edges, content)

        # ── Calibrate confidence ──
        edges = _calibrate_confidence(edges, content)

        result = _validate_and_sanitize({"summary": summary, "nodes": nodes, "edges": edges})
        logger.info("Extraction complete: %d nodes, %d edges", len(result["nodes"]), len(result["edges"]))
        return result

    async def _validate_evidence(self, edges: list[dict], source_text: str) -> None:
        """Cross-validate evidence against source text via LLM."""
        if not edges:
            return

        # Quick local pre-filter: remove edges with no evidence match
        for edge in edges:
            evidence = edge.get("evidence", "")
            if evidence and evidence != "(no evidence provided)":
                sim = _text_similarity(evidence, source_text)
                if sim < 0.15:
                    # Very weak evidence, down-grade confidence
                    edge["confidence"] = min(edge.get("confidence", 0.5), 0.4)
                    logger.debug("Low evidence similarity for edge %s: %.2f", edge.get("temp_id"), sim)

        # LLM-based validation (only for edges with weak evidence)
        weak_edges = [
            e for e in edges
            if e.get("confidence", 1.0) < 0.5 or e.get("evidence", "") == "(no evidence provided)"
        ]
        if not weak_edges:
            return

        validation_prompt = (
            f"原文：\n{source_text[:2000]}\n\n"
            f"需要验证的关系：\n{json.dumps(weak_edges, ensure_ascii=False, indent=2)}"
        )
        try:
            validation_raw = await self._llm.generate_json(
                system_prompt=_STAGE4_SYSTEM,
                user_prompt=validation_prompt,
            )
            validation = _parse_json_response(validation_raw)
            if not validation or "results" not in validation:
                return

            result_map = {r["edge_id"]: r for r in validation["results"] if "edge_id" in r}
            for edge in weak_edges:
                eid = edge.get("temp_id", "")
                val = result_map.get(eid)
                if val and val.get("status") == "weak":
                    correction = val.get("correction")
                    if correction:
                        edge["evidence"] = correction
                    edge["confidence"] = min(edge.get("confidence", 0.5), 0.3)
        except Exception as e:
            logger.warning("Evidence validation failed: %s", e)

    async def _extract_singlestage(self, title: str, content: str) -> dict:
        """Fallback: single-stage extraction (original approach)."""

        system_prompt = (
            "你是一个个人知识库系统的信息抽取模块。你的任务是把用户提供的一篇文章转化成局部知识图谱。\n\n"
            "你需要抽取文章中的核心概念、实体、工具、方法、问题和明确观点。"
            "不要抽取过于泛化的词，例如\"系统\"\"数据\"\"用户\"\"平台\"\"模型\"，"
            "除非它们在文章中具有明确技术含义。\n\n"
            "你需要输出严格 JSON，不要输出 Markdown，不要输出解释文字。\n\n"
            "节点类型只能使用：\n"
            "article, concept, claim, topic, person, organization, paper, project, "
            "framework, tool, method, technology, question\n\n"
            "关系类型只能使用：\n"
            "related_to, contains, part_of, supports, contradicts, depends_on, "
            "implements, improves, causes, compares_with, derived_from, used_for, "
            "evidence_for, mentions, similar_to, belongs_to\n\n"
            "每个关系必须有 evidence。evidence 尽量引用原文中的句子。\n\n"
            + _RELATION_GUIDANCE + "\n"
            "输出 JSON 格式：\n"
            '{\n  "summary": "文章摘要",\n  "nodes": [\n    {"temp_id": "n1", "node_type": "类型", "name": "名称", "description": "描述"}\n  ],\n'
            '  "edges": [\n    {"temp_id": "e1", "source": "n1", "target": "n2", "relation_type": "关系类型", "confidence": 0.9, "evidence": "原文证据"}\n  ]\n}'
        )

        user_prompt = f"文章标题：{title}\n\n文章内容：\n{content}"

        raw_response = await self._llm.generate_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

        raw = _parse_json_response(raw_response)
        if not raw:
            return {"summary": "", "nodes": [], "edges": []}

        return _validate_and_sanitize(raw)
