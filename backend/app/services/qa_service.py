import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.llm_client import LLMClient
from .search_service import SearchService

logger = logging.getLogger(__name__)

QA_SYSTEM_PROMPT = """你是一个个人知识库的问答助手。请根据提供的上下文回答用户的问题。

要求：
1. 回答必须基于提供的上下文内容，不要编造信息
2. 如果上下文不足以回答问题，请明确说明
3. 引用具体的证据来源
4. 用中文回答

上下文：
{context}"""


class QAService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.search = SearchService(db)
        self.llm = LLMClient()

    async def ask(self, question: str) -> dict:
        # Semantic + graph-enhanced search
        search_results = await self.search.graph_enhanced_search(question, top_k=8)

        # Build context from search results
        context_parts = []

        for chunk in search_results.get("chunks", []):
            context_parts.append(f"[文档片段] {chunk.get('content', '')}")

        for node in search_results.get("nodes", []):
            context_parts.append(
                f"[知识节点] {node.get('name', '')} ({node.get('node_type', '')}): "
                f"{node.get('description', '')}"
            )

        for doc in search_results.get("documents", []):
            context_parts.append(f"[文档] {doc.get('title', '')}: {doc.get('summary', '')}")

        for edge in search_results.get("graph_context", {}).get("edges", []):
            context_parts.append(
                f"[关系] {edge.get('source', '')} -> {edge.get('relation_type', '')} -> "
                f"{edge.get('target', '')}: {edge.get('evidence_text', '')}"
            )

        context = "\n\n".join(context_parts[:20])  # Limit context size

        # Generate answer
        try:
            system = QA_SYSTEM_PROMPT.format(context=context)
            answer = await self.llm.generate(question, system=system)
        except Exception as e:
            logger.error(f"QA LLM call failed: {e}")
            answer = "抱歉，生成回答时出现错误。"

        # Build evidence citations
        evidence = []
        for chunk in search_results.get("chunks", [])[:5]:
            evidence.append({
                "source": "chunk",
                "text": chunk.get("content", "")[:200],
                "document_title": None,
            })
        for doc in search_results.get("documents", [])[:3]:
            evidence.append({
                "source": "document",
                "text": doc.get("summary", ""),
                "document_title": doc.get("title"),
            })

        return {
            "answer": answer,
            "evidence": evidence,
        }
