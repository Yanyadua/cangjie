"""Graph quality evaluator using information reconstruction method."""

import json
import logging
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

_GT_SYSTEM = (
    "你是知识评估专家。\n\n"
    "请从以下文章中提取最重要的知识点列表（5-10个）。\n"
    "每个知识点用一句话概括，要具体、可验证。\n\n"
    "输出严格 JSON：\n"
    '{"knowledge_points": ["知识点1", "知识点2", ...]}'
)

_RECONSTRUCT_SYSTEM = (
    "你是知识图谱阅读者。\n\n"
    "以下是一个知识图谱的 JSON 数据。\n"
    "请仅根据图谱中的信息（不要猜测、不要补充外部知识），"
    "列出你能从这个图谱中领会的知识点。\n"
    "每个知识点用一句话概括。\n\n"
    "输出严格 JSON：\n"
    '{"knowledge_points": ["知识点1", "知识点2", ...]}'
)

_COMPARE_SYSTEM = (
    "你是评分员。\n\n"
    "请对比两组知识点：\n"
    "- Ground Truth（从原文提取）\n"
    "- 重建（从图谱推断）\n\n"
    "请判断每个 ground truth 知识点是否在重建列表中有对应的匹配项（语义等价即可，不要求字面相同）。\n"
    "同时标记重建列表中多出来的知识点（hallucinated）。\n\n"
    "输出严格 JSON：\n"
    "{\n"
    '  "matched": [{"gt": "原文知识点", "reconstructed": "图谱中对应知识点"}],\n'
    '  "missed": ["未在图谱中恢复的原有知识点"],\n'
    '  "hallucinated": ["图谱中重建出但原文没有的知识点"],\n'
    '  "recall": 0.0,\n'
    '  "precision": 0.0\n'
    "}\n\n"
    "recall = len(matched) / len(ground_truth)\n"
    "precision = len(matched) / len(reconstructed)"
)

_MAX_CONTENT_LEN = 8000


class GraphEvaluator:
    """使用信息重建法评估图谱质量。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def extract_ground_truth(self, title: str, content: str) -> list[str]:
        """从原文提取 ground truth 知识点。"""
        truncated = content[:_MAX_CONTENT_LEN]
        prompt = f"文章标题：{title}\n\n文章内容：\n{truncated}"

        try:
            raw = await self.llm.generate_json(
                system_prompt=_GT_SYSTEM, user_prompt=prompt, temperature=0.2,
            )
            return raw.get("knowledge_points", [])
        except Exception as e:
            logger.error(f"Ground truth extraction failed: {e}")
            return []

    async def reconstruct_from_graph(self, graph_json: dict) -> list[str]:
        """让 LLM 只看图谱，重建知识点。"""
        graph_summary = self._summarize_graph(graph_json)
        prompt = f"图谱数据：\n{graph_summary}"

        try:
            raw = await self.llm.generate_json(
                system_prompt=_RECONSTRUCT_SYSTEM, user_prompt=prompt, temperature=0.2,
            )
            return raw.get("knowledge_points", [])
        except Exception as e:
            logger.error(f"Graph reconstruction failed: {e}")
            return []

    async def compare_and_score(
        self, ground_truth: list[str], reconstructed: list[str],
    ) -> dict[str, Any]:
        """对比两组知识点，返回评分。"""
        prompt = json.dumps({
            "ground_truth": ground_truth,
            "reconstructed": reconstructed,
        }, ensure_ascii=False, indent=2)

        try:
            raw = await self.llm.generate_json(
                system_prompt=_COMPARE_SYSTEM, user_prompt=prompt, temperature=0.1,
            )
            recall = float(raw.get("recall", 0.0))
            precision = float(raw.get("precision", 0.0))
            f1 = (2 * recall * precision / (recall + precision)) if (recall + precision) > 0 else 0.0
            return {
                "matched": raw.get("matched", []),
                "missed": raw.get("missed", []),
                "hallucinated": raw.get("hallucinated", []),
                "recall": round(recall, 4),
                "precision": round(precision, 4),
                "f1": round(f1, 4),
            }
        except Exception as e:
            logger.error(f"Compare and score failed: {e}")
            return {
                "matched": [], "missed": list(ground_truth),
                "hallucinated": list(reconstructed),
                "recall": 0.0, "precision": 0.0, "f1": 0.0,
            }

    def compute_structure_metrics(self, graph_json: dict) -> dict:
        """计算图谱结构指标。"""
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        node_ids = {n.get("temp_id") or n.get("id") for n in nodes}
        connected = set()
        for e in edges:
            connected.add(e.get("source"))
            connected.add(e.get("target"))

        isolated = node_ids - connected

        with_evidence = sum(1 for e in edges if e.get("evidence", "").strip())

        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "isolated_nodes": len(isolated),
            "evidence_coverage": round(with_evidence / len(edges), 4) if edges else 0.0,
        }

    @staticmethod
    def _summarize_graph(graph_json: dict) -> str:
        """将图谱压缩为 LLM 可读的文本摘要。"""
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        lines = [f"摘要: {graph_json.get('summary', '无')}", "", "节点:"]

        for n in nodes:
            nt = n.get("node_type", "?")
            name = n.get("name", "?")
            desc = n.get("description", "")
            lines.append(f"  [{nt}] {name}: {desc}")

        lines.append("")
        lines.append("关系:")

        for e in edges:
            src = e.get("source", "?")
            tgt = e.get("target", "?")
            rel = e.get("relation_type", "?")
            ev = e.get("evidence", "")
            lines.append(f"  {src} --[{rel}]--> {tgt}  证据: {ev}")

        return "\n".join(lines)
