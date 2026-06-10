import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models.db_models import Node, Edge, NodeAlias

logger = logging.getLogger(__name__)


class GraphStore:
    """Graph storage and query operations using PostgreSQL."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_node(self, node_id: UUID) -> Optional[dict]:
        """Get a single node by ID."""
        result = await self.db.execute(
            select(Node).where(Node.id == node_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None
        return self._node_to_dict(node)

    async def get_node_with_aliases(self, node_id: UUID) -> Optional[dict]:
        result = await self.db.execute(
            select(Node).options(selectinload(Node.aliases)).where(Node.id == node_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None
        d = self._node_to_dict(node)
        d["aliases"] = [a.alias for a in node.aliases]
        return d

    async def get_node_neighbors(self, node_id: UUID, hops: int = 1) -> dict:
        """Get subgraph around a node within N hops."""
        visited_nodes = {node_id}
        all_edges = []
        frontier = {node_id}

        for _ in range(hops):
            next_frontier = set()
            for nid in frontier:
                result = await self.db.execute(
                    select(Edge).where(
                        and_(
                            Edge.status == "active",
                            or_(
                                Edge.source_node_id == nid,
                                Edge.target_node_id == nid,
                            ),
                        )
                    )
                )
                edges = result.scalars().all()
                for e in edges:
                    all_edges.append(e)
                    if e.source_node_id not in visited_nodes:
                        next_frontier.add(e.source_node_id)
                    if e.target_node_id not in visited_nodes:
                        next_frontier.add(e.target_node_id)
            visited_nodes.update(next_frontier)
            frontier = next_frontier
            if not frontier:
                break

        # Fetch all visited nodes
        result = await self.db.execute(
            select(Node).where(Node.id.in_(visited_nodes))
        )
        nodes = result.scalars().all()

        return {
            "nodes": [self._node_to_dict(n) for n in nodes],
            "edges": [self._edge_to_dict(e) for e in all_edges],
        }

    async def create_node(
        self,
        node_type: str,
        name: str,
        description: Optional[str] = None,
        canonical_name: Optional[str] = None,
        source_document_id: Optional[UUID] = None,
    ) -> UUID:
        node = Node(
            id=uuid4(),
            node_type=node_type,
            name=name,
            canonical_name=canonical_name,
            description=description,
            source_document_id=source_document_id,
        )
        self.db.add(node)
        await self.db.flush()
        return node.id

    async def create_edge(
        self,
        source_id: UUID,
        target_id: UUID,
        relation_type: str,
        confidence: float = 1.0,
        evidence_document_id: Optional[UUID] = None,
        evidence_chunk_id: Optional[UUID] = None,
        evidence_text: Optional[str] = None,
    ) -> UUID:
        edge = Edge(
            id=uuid4(),
            source_node_id=source_id,
            target_node_id=target_id,
            relation_type=relation_type,
            confidence=confidence,
            evidence_document_id=evidence_document_id,
            evidence_chunk_id=evidence_chunk_id,
            evidence_text=evidence_text,
        )
        self.db.add(edge)
        await self.db.flush()
        return edge.id

    async def merge_nodes(self, source_id: UUID, target_id: UUID) -> UUID:
        """Merge source node into target node. Target survives."""
        # Reassign all edges from source to target
        await self.db.execute(
            Edge.__table__.update()
            .where(Edge.source_node_id == source_id)
            .values(source_node_id=target_id)
        )
        await self.db.execute(
            Edge.__table__.update()
            .where(Edge.target_node_id == source_id)
            .values(target_node_id=target_id)
        )
        # Add source name as alias on target
        source_node = await self.db.execute(
            select(Node).where(Node.id == source_id)
        )
        source = source_node.scalar_one_or_none()
        if source:
            alias = NodeAlias(id=uuid4(), node_id=target_id, alias=source.name)
            self.db.add(alias)
            # Mark source as merged
            source.status = "merged"

        await self.db.flush()
        return target_id

    async def update_node(self, node_id: UUID, **kwargs) -> None:
        await self.db.execute(
            Node.__table__.update().where(Node.id == node_id).values(**kwargs)
        )
        await self.db.flush()

    async def update_edge(self, edge_id: UUID, **kwargs) -> None:
        await self.db.execute(
            Edge.__table__.update().where(Edge.id == edge_id).values(**kwargs)
        )
        await self.db.flush()

    async def search_nodes(self, query: str, limit: int = 20) -> List[dict]:
        result = await self.db.execute(
            select(Node)
            .where(
                and_(
                    Node.status == "active",
                    or_(
                        Node.name.ilike(f"%{query}%"),
                        Node.canonical_name.ilike(f"%{query}%"),
                    ),
                )
            )
            .limit(limit)
        )
        nodes = result.scalars().all()
        return [self._node_to_dict(n) for n in nodes]

    async def get_all_active_nodes(self, limit: int = 500) -> List[dict]:
        result = await self.db.execute(
            select(Node).where(Node.status == "active").limit(limit)
        )
        nodes = result.scalars().all()
        return [self._node_to_dict(n) for n in nodes]

    async def get_edges_for_nodes(self, node_ids: List[UUID]) -> List[dict]:
        result = await self.db.execute(
            select(Edge).where(
                and_(
                    Edge.status == "active",
                    Edge.source_node_id.in_(node_ids),
                    Edge.target_node_id.in_(node_ids),
                )
            )
        )
        edges = result.scalars().all()
        return [self._edge_to_dict(e) for e in edges]

    def _node_to_dict(self, node: Node) -> dict:
        return {
            "id": str(node.id),
            "node_type": node.node_type,
            "name": node.name,
            "canonical_name": node.canonical_name,
            "description": node.description,
            "source_document_id": str(node.source_document_id) if node.source_document_id else None,
            "status": node.status,
        }

    def _edge_to_dict(self, edge: Edge) -> dict:
        return {
            "id": str(edge.id),
            "source": str(edge.source_node_id),
            "target": str(edge.target_node_id),
            "relation_type": edge.relation_type,
            "confidence": edge.confidence,
            "evidence_document_id": str(edge.evidence_document_id) if edge.evidence_document_id else None,
            "evidence_chunk_id": str(edge.evidence_chunk_id) if edge.evidence_chunk_id else None,
            "evidence_text": edge.evidence_text,
            "status": edge.status,
        }
