import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..models.db_models import Node, Edge, NodeAlias
from ..core.graph_store import GraphStore

logger = logging.getLogger(__name__)


class GraphService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_store = GraphStore(db)

    async def get_local_graph(self, node_id: str, hops: int = 1) -> Optional[dict]:
        try:
            return await self.graph_store.get_node_neighbors(UUID(node_id), hops=hops)
        except Exception as e:
            logger.error(f"Failed to get local graph: {e}")
            return None

    async def get_node(self, node_id: str) -> Optional[dict]:
        return await self.graph_store.get_node(UUID(node_id))

    async def get_node_detail(self, node_id: str) -> Optional[dict]:
        """Get node with aliases, edges, and related documents."""
        node = await self.graph_store.get_node_with_aliases(UUID(node_id))
        if not node:
            return None

        # Get edges
        neighbors = await self.graph_store.get_node_neighbors(UUID(node_id), hops=1)

        in_edges = [e for e in neighbors.get("edges", []) if e["target"] == node_id]
        out_edges = [e for e in neighbors.get("edges", []) if e["source"] == node_id]

        return {
            **node,
            "in_edges": in_edges,
            "out_edges": out_edges,
            "related_documents": [],
        }
