"""Service for managing partition nodes (personal knowledge domains)."""

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from ..models.db_models import Node, Edge
from ..core.graph_store import GraphStore
from ..core.embedding_client import EmbeddingClient
from ..core.vector_store import VectorStore

logger = logging.getLogger(__name__)


class PartitionService:
    """CRUD + embedding management for partition nodes."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_store = GraphStore(db)
        self.embedding = EmbeddingClient()
        self.vector_store = VectorStore(db)

    async def _count_edges(self, partition_id: UUID, relation_type: str) -> int:
        result = await self.db.execute(
            select(func.count(Edge.id)).where(
                and_(
                    Edge.target_node_id == partition_id,
                    Edge.relation_type == relation_type,
                    Edge.status == "active",
                )
            )
        )
        return result.scalar() or 0

    async def list_partitions(self) -> list[dict]:
        result = await self.db.execute(
            select(Node).where(
                and_(Node.node_type == "partition", Node.status == "active")
            ).order_by(Node.created_at.desc())
        )
        partitions = result.scalars().all()

        out = []
        for p in partitions:
            article_count = await self._count_edges(p.id, "belongs_to")
            topic_count = await self._count_edges(p.id, "part_of")
            out.append({
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "article_count": article_count,
                "topic_count": topic_count,
            })
        return out

    async def create_partition(self, name: str, description: str = "") -> dict:
        me_id = await self.graph_store.ensure_me_node()

        partition_id = await self.graph_store.create_node(
            node_type="partition",
            name=name,
            description=description,
        )

        # me --root--> partition
        await self.graph_store.create_edge(
            source_id=me_id,
            target_id=partition_id,
            relation_type="root",
            confidence=1.0,
        )

        # 生成 embedding
        try:
            emb = await self.embedding.embed(f"{name} {description}".strip())
            await self.vector_store.upsert_node_embedding(partition_id, emb)
        except Exception as e:
            logger.warning(f"Partition embedding failed: {e}")

        await self.db.commit()
        return {"id": str(partition_id), "name": name, "description": description}

    async def update_partition(
        self,
        partition_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[dict]:
        result = await self.db.execute(
            select(Node).where(Node.id == partition_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None

        desc_changed = False
        if name is not None:
            node.name = name
        if description is not None:
            node.description = description
            desc_changed = True

        await self.db.flush()

        # description 变更时重新生成 embedding
        if desc_changed:
            try:
                emb_text = f"{node.name} {node.description or ''}".strip()
                emb = await self.embedding.embed(emb_text)
                await self.vector_store.upsert_node_embedding(UUID(partition_id), emb)
            except Exception as e:
                logger.warning(f"Partition embedding update failed: {e}")

        await self.db.commit()
        return {"id": str(node.id), "name": node.name, "description": node.description}

    async def delete_partition(self, partition_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(Node).where(Node.id == partition_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None

        node.status = "deleted"
        await self.db.commit()
        return {"id": str(node.id), "status": "deleted"}
