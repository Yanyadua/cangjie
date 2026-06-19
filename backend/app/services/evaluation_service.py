"""Evaluation orchestration service."""

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.llm_client import LLMClient
from ..core.graph_extractor import GraphExtractor, _validate_and_sanitize, _calibrate_confidence
from ..core.graph_evaluator import GraphEvaluator
from ..models.db_models import Document

logger = logging.getLogger(__name__)

# 策略档位预设
STRATEGIES: dict[str, dict[str, Any]] = {
    "concise": {
        "label": "简洁",
        "temperature": 0.1,
        "extra_instruction": "只提取文章最核心的主题和主张，忽略次要实体。目标 5-8 个节点。",
        "mode": "standard",
    },
    "standard": {
        "label": "标准",
        "temperature": 0.3,
        "extra_instruction": "",
        "mode": "standard",
    },
    "detailed": {
        "label": "详细",
        "temperature": 0.6,
        "extra_instruction": "尽可能详细展开，包括次要概念、具体工具和方法。目标 15-25 个节点。",
        "mode": "standard",
    },
    "proposition": {
        "label": "命题化",
        "temperature": 0.3,
        "extra_instruction": "",
        "mode": "proposition",
    },
}


class EvaluationService:
    """编排图谱评估流程。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.extractor = GraphExtractor(self.llm)
        self.evaluator = GraphEvaluator(self.llm)

    async def run_evaluation(
        self, document_id: str, strategies: list[str],
    ) -> dict[str, Any]:
        """运行完整评估流程。"""
        # 1. 获取原文
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return {"error": "Document not found"}

        title = doc.title
        content = doc.cleaned_content or doc.raw_content

        # 2. 提取 ground truth（只做一次）
        ground_truth = await self.evaluator.extract_ground_truth(title, content)

        # 3. 对每个策略运行评估
        results = []
        for strategy_key in strategies:
            strategy = STRATEGIES.get(strategy_key)
            if not strategy:
                continue
            try:
                item = await self._evaluate_strategy(
                    title, content, strategy_key, strategy, ground_truth,
                )
                results.append(item)
            except Exception as e:
                logger.error(f"Strategy '{strategy_key}' evaluation failed: {e}")
                results.append({
                    "strategy": strategy_key,
                    "label": strategy.get("label", strategy_key),
                    "error": str(e),
                })

        return {
            "document_title": title,
            "ground_truth": ground_truth,
            "results": results,
        }

    async def _evaluate_strategy(
        self,
        title: str,
        content: str,
        strategy_key: str,
        strategy: dict,
        ground_truth: list[str],
    ) -> dict[str, Any]:
        """评估单个策略。"""
        temp = strategy["temperature"]
        extra = strategy["extra_instruction"]

        # 抽取
        skeleton = await self.extractor.run_skeleton(
            title, content, temperature=temp, extra_instruction=extra,
        )
        expanded = await self.extractor.run_expand(
            title, content, skeleton,
            temperature=temp, extra_instruction=extra,
            mode=strategy.get("mode", "standard"),
        )

        # 校验清洗（复用现有逻辑）
        nodes = expanded.get("nodes", [])
        edges = expanded.get("edges", [])
        edges = _calibrate_confidence(edges, content)
        graph_json = _validate_and_sanitize({
            "summary": skeleton.get("summary", ""),
            "nodes": nodes,
            "edges": edges,
        })

        # 重建知识点
        reconstructed = await self.evaluator.reconstruct_from_graph(graph_json)

        # 对比评分
        scores = await self.evaluator.compare_and_score(ground_truth, reconstructed)

        # 结构指标
        structure = self.evaluator.compute_structure_metrics(graph_json)

        return {
            "strategy": strategy_key,
            "label": strategy["label"],
            "graph": graph_json,
            "reconstructed": reconstructed,
            "scores": {
                **scores,
                **structure,
            },
        }
