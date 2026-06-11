"""
Tag generator for the Global Knowledge Network.

Takes article summary + core concepts from extraction stage 1,
calls LLM to generate 3-5 topic tags.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

_TAG_SYSTEM_PROMPT = (
    "你是一个个人知识库的主题标签生成模块。\n"
    "\n"
    "你将收到：\n"
    "1. 文章摘要\n"
    "2. 文章的核心概念列表\n"
    "\n"
    "请为这篇文章生成 3-5 个主题标签。每个标签代表这篇文章在个人知识网络中应该归属的主题域。\n"
    "\n"
    "要求：\n"
    "- 标签应覆盖文章的主要知识领域，而非具体实体\n"
    "- 优先使用已有的常见知识领域名称（如'机器学习'、'智能体评测'、'前端开发'）\n"
    "- 避免过于宽泛（如'技术'）或过于狭窄（如'2024年某论文的某个实验'）\n"
    "\n"
    "输出严格 JSON，不要输出 Markdown，不要输出解释文字。\n"
    "\n"
    "JSON 格式：\n"
    "{\n"
    '  "tags": [\n'
    "    {\n"
    '      "name": "标签名称",\n'
    '      "confidence": 0.0,\n'
    '      "reason": "为什么这个标签适合这篇文章"\n'
    "    }\n"
    "  ]\n"
    "}"
)

_TAG_FEWSHOT_INPUT = """文章摘要：本文介绍了微软研究院提出的 GraphRAG 方法，通过知识图谱和社区检测改进传统 RAG 的全局推理能力。

核心概念：
- GraphRAG（method）：微软研究院提出的基于知识图谱的检索增强生成方法
- 知识图谱（concept）：GraphRAG 的基础数据结构
- 社区检测（method）：将知识图谱划分为局部子图的算法
- Leiden 算法（method）：社区检测算法
- 传统 RAG（concept）：基于向量相似度的检索增强生成方法"""

_TAG_FEWSHOT_OUTPUT = json.dumps({
    "tags": [
        {"name": "知识图谱", "confidence": 0.95, "reason": "文章核心主题是基于知识图谱的检索增强方法"},
        {"name": "检索增强生成", "confidence": 0.92, "reason": "GraphRAG 是 RAG 的改进方法"},
        {"name": "社区检测", "confidence": 0.85, "reason": "社区检测是 GraphRAG 的关键技术组件"},
        {"name": "自然语言处理", "confidence": 0.7, "reason": "GraphRAG 属于 NLP 领域的应用研究"},
    ]
}, ensure_ascii=False, indent=2)


class TagGenerator:
    """Generate topic tags for articles using LLM."""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def generate_tags(
        self,
        summary: str,
        core_concepts: list[dict[str, str]],
    ) -> list[dict[str, Any]]:
        """Generate topic tags from article summary and core concepts."""
        concepts_text = "\n".join(
            f"- {c['name']}（{c.get('type', 'concept')}）：{c.get('description', '')}"
            for c in core_concepts
        )

        user_prompt = f"文章摘要：{summary}\n\n核心概念：\n{concepts_text}"

        system_prompt = (
            _TAG_SYSTEM_PROMPT
            + "\n\n示例输入：\n" + _TAG_FEWSHOT_INPUT
            + "\n\n示例输出：\n" + _TAG_FEWSHOT_OUTPUT
        )

        raw = await self.llm.generate_json(system_prompt, user_prompt)

        tags = raw.get("tags", [])
        valid_tags = []
        for t in tags:
            if not isinstance(t, dict) or "name" not in t:
                continue
            valid_tags.append({
                "name": str(t["name"]).strip(),
                "confidence": min(1.0, max(0.0, float(t.get("confidence", 0.5)))),
                "reason": str(t.get("reason", "")),
            })

        seen: dict[str, dict] = {}
        for t in valid_tags:
            key = t["name"].lower()
            if key not in seen or t["confidence"] > seen[key]["confidence"]:
                seen[key] = t

        return list(seen.values())[:5]
