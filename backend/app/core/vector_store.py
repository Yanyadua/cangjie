import json
import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class VectorStore:
    """Vector store using pgvector for similarity search."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upsert_node_embedding(self, node_id: UUID, embedding: List[float]) -> None:
        """Store embedding for a node."""
        emb_str = "[" + ",".join(str(v) for v in embedding) + "]"
        await self.db.execute(
            text("UPDATE nodes SET embedding = :emb WHERE id = :id"),
            {"emb": emb_str, "id": str(node_id)},
        )

    async def upsert_chunk_embedding(self, chunk_id: UUID, embedding: List[float]) -> None:
        """Store embedding for a chunk."""
        emb_str = "[" + ",".join(str(v) for v in embedding) + "]"
        await self.db.execute(
            text("UPDATE chunks SET embedding = :emb WHERE id = :id"),
            {"emb": emb_str, "id": str(chunk_id)},
        )

    async def upsert(self, table: str, record_id: UUID, embedding: List[float]) -> None:
        """Generic upsert embedding."""
        emb_str = "[" + ",".join(str(v) for v in embedding) + "]"
        await self.db.execute(
            text(f"UPDATE {table} SET embedding = :emb WHERE id = :id"),
            {"emb": emb_str, "id": str(record_id)},
        )

    async def search_nodes(
        self, query_embedding: List[float], top_k: int = 10, node_type: Optional[str] = None
    ) -> List[dict]:
        """Search similar nodes by embedding."""
        emb_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

        type_filter = ""
        params = {"emb": emb_str, "top_k": top_k}
        if node_type:
            type_filter = "AND node_type = :node_type"
            params["node_type"] = node_type

        query_sql = f"""
            SELECT id, node_type, name, description,
                   embedding::vector <=> CAST(:emb AS vector) AS distance
            FROM nodes
            WHERE status = 'active' AND embedding IS NOT NULL {type_filter}
            ORDER BY embedding::vector <=> CAST(:emb AS vector)
            LIMIT :top_k
        """
        result = await self.db.execute(text(query_sql), params)
        rows = result.fetchall()
        return [
            {
                "id": str(row.id),
                "node_type": row.node_type,
                "name": row.name,
                "description": row.description,
                "score": 1.0 - row.distance,
            }
            for row in rows
        ]

    async def search_chunks(
        self, query_embedding: List[float], top_k: int = 10
    ) -> List[dict]:
        """Search similar chunks by embedding."""
        emb_str = "[" + ",".join(str(v) for v in query_embedding) + "]"
        query_sql = """
            SELECT c.id, c.document_id, c.content,
                   c.embedding::vector <=> CAST(:emb AS vector) AS distance
            FROM chunks c
            WHERE c.embedding IS NOT NULL
            ORDER BY c.embedding::vector <=> CAST(:emb AS vector)
            LIMIT :top_k
        """
        result = await self.db.execute(text(query_sql), {"emb": emb_str, "top_k": top_k})
        rows = result.fetchall()
        return [
            {
                "id": str(row.id),
                "document_id": str(row.document_id),
                "content": row.content,
                "score": 1.0 - row.distance,
            }
            for row in rows
        ]

    async def delete(self, table: str, record_id: UUID) -> None:
        """Clear embedding for a record."""
        await self.db.execute(
            text(f"UPDATE {table} SET embedding = NULL WHERE id = :id"),
            {"id": str(record_id)},
        )
