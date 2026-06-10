import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.db_models import Node, Chunk, Document
from ..core.embedding_client import EmbeddingClient
from ..core.vector_store import VectorStore
from ..core.graph_store import GraphStore

logger = logging.getLogger(__name__)


class SearchService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.embedding = EmbeddingClient()
        self.vector_store = VectorStore(db)
        self.graph_store = GraphStore(db)

    async def semantic_search(self, query: str, top_k: int = 10) -> dict:
        try:
            query_emb = await self.embedding.embed(query)
        except Exception as e:
            logger.error(f"Query embedding failed: {e}")
            return {"chunks": [], "nodes": [], "documents": []}

        # Search chunks
        try:
            chunk_results = await self.vector_store.search_chunks(query_emb, top_k=top_k)
        except Exception as e:
            logger.warning(f"Chunk search failed: {e}")
            chunk_results = []

        # Search nodes
        try:
            node_results = await self.vector_store.search_nodes(query_emb, top_k=top_k)
        except Exception as e:
            logger.warning(f"Node search failed: {e}")
            node_results = []

        # Get related documents
        doc_ids = set()
        for c in chunk_results:
            doc_ids.add(c.get("document_id"))
        for n in node_results:
            if n.get("source_document_id"):
                doc_ids.add(n["source_document_id"])

        documents = []
        if doc_ids:
            from uuid import UUID
            result = await self.db.execute(
                select(Document).where(Document.id.in_([UUID(d) for d in doc_ids]))
            )
            docs = result.scalars().all()
            documents = [
                {
                    "id": str(d.id),
                    "title": d.title,
                    "summary": d.summary,
                    "status": d.status,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in docs
            ]

        return {
            "chunks": chunk_results,
            "nodes": node_results,
            "documents": documents,
        }

    async def graph_enhanced_search(self, query: str, top_k: int = 10) -> dict:
        # Start with semantic search
        base = await self.semantic_search(query, top_k=top_k)

        # Expand 1-hop from matched nodes
        graph_context = {"nodes": [], "edges": []}
        from uuid import UUID
        for node in base.get("nodes", []):
            try:
                neighbors = await self.graph_store.get_node_neighbors(
                    UUID(node["id"]), hops=1
                )
                graph_context["nodes"].extend(neighbors.get("nodes", []))
                graph_context["edges"].extend(neighbors.get("edges", []))
            except Exception:
                pass

        # Deduplicate nodes
        seen = set()
        unique_nodes = []
        for n in graph_context["nodes"]:
            if n["id"] not in seen:
                seen.add(n["id"])
                unique_nodes.append(n)
        graph_context["nodes"] = unique_nodes

        base["graph_context"] = graph_context
        return base
