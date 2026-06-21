import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import select, and_, or_, text, func
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
        parent_node_id: Optional[UUID] = None,
    ) -> UUID:
        node = Node(
            id=uuid4(),
            node_type=node_type,
            name=name,
            canonical_name=canonical_name,
            description=description,
            source_document_id=source_document_id,
            parent_node_id=parent_node_id,
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
        """Merge source node into target node. Target survives.

        - source 的所有边转移到 target
        - 转移后产生自环边（target→target）标记为 inactive
        - source 名称作为别名添加到 target
        - source 标记为 "merged"
        """
        if source_id == target_id:
            raise ValueError("不能合并到自身")

        # 校验 source 和 target 都存在且 active
        src_result = await self.db.execute(
            select(Node).where(and_(Node.id == source_id, Node.status == "active"))
        )
        source = src_result.scalar_one_or_none()
        if not source:
            raise ValueError(f"源节点不存在或已合并: {source_id}")

        tgt_result = await self.db.execute(
            select(Node).where(and_(Node.id == target_id, Node.status == "active"))
        )
        if not tgt_result.scalar_one_or_none():
            raise ValueError(f"目标节点不存在或已合并: {target_id}")

        # 转移所有边
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

        # 清理自环边（合并后 target→target 的边）
        await self.db.execute(
            Edge.__table__.update()
            .where(and_(
                Edge.source_node_id == target_id,
                Edge.target_node_id == target_id,
                Edge.status == "active",
            ))
            .values(status="inactive")
        )

        # 添加别名（检查是否已存在同名别名）
        existing_alias = await self.db.execute(
            select(NodeAlias).where(
                and_(NodeAlias.node_id == target_id, NodeAlias.alias == source.name)
            )
        )
        if not existing_alias.scalar_one_or_none():
            self.db.add(NodeAlias(id=uuid4(), node_id=target_id, alias=source.name))

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

    async def ensure_me_node(self) -> UUID:
        """获取或创建唯一的 person 节点（"我"），作为全局图根节点。"""
        result = await self.db.execute(
            select(Node).where(
                and_(Node.node_type == "person", Node.status == "active")
            ).limit(1)
        )
        me = result.scalar_one_or_none()
        if me:
            return me.id
        me_id = await self.create_node(
            node_type="person",
            name="我",
            description="知识图谱中心节点",
        )
        await self.db.flush()
        return me_id

    async def attach_orphan_partitions(self, me_id: UUID) -> int:
        """为所有无 root 入边的 partition 补建 person --root--> partition 边。

        返回新建的边数。用于一次性修复存量孤悬分区，使径向图谱层级完整。
        """
        result = await self.db.execute(
            select(Node).where(
                and_(Node.node_type == "partition", Node.status == "active")
            )
        )
        partitions = result.scalars().all()

        created = 0
        for p in partitions:
            existing = await self.db.execute(
                select(Edge).where(
                    and_(
                        Edge.target_node_id == p.id,
                        Edge.relation_type == "root",
                    )
                ).limit(1)
            )
            if existing.scalar_one_or_none():
                continue
            await self.create_edge(
                source_id=me_id,
                target_id=p.id,
                relation_type="root",
                confidence=1.0,
            )
            created += 1
        if created:
            await self.db.flush()
        return created

    async def detect_duplicate_topics(self, threshold: float = 0.85) -> List[dict]:
        """检测全局图谱中语义相似的 topic 节点对。

        用 pgvector cross-join 找出余弦相似度高于阈值的所有 topic 对。
        返回 [{source, target, similarity}, ...] 按 similarity 降序。
        """
        distance_threshold = 1.0 - threshold
        sql = text("""
            SELECT a.id AS a_id, a.name AS a_name, a.description AS a_desc,
                   b.id AS b_id, b.name AS b_name, b.description AS b_desc,
                   a.embedding::vector <=> b.embedding::vector AS distance
            FROM nodes a
            JOIN nodes b ON a.id < b.id
            WHERE a.node_type = 'topic' AND a.status = 'active' AND a.embedding IS NOT NULL
              AND b.node_type = 'topic' AND b.status = 'active' AND b.embedding IS NOT NULL
              AND a.embedding::vector <=> b.embedding::vector < :threshold
            ORDER BY distance
            LIMIT 50
        """)
        result = await self.db.execute(sql, {"threshold": distance_threshold})
        rows = result.fetchall()
        return [
            {
                "source": {
                    "id": str(r.a_id), "name": r.a_name, "description": r.a_desc,
                },
                "target": {
                    "id": str(r.b_id), "name": r.b_name, "description": r.b_desc,
                },
                "similarity": round(1.0 - r.distance, 4),
            }
            for r in rows
        ]

    async def reassign_edges(
        self,
        old_target_id: UUID,
        new_target_id: UUID,
        relation_types: List[str],
    ) -> int:
        """将指向 old_target 的指定类型 active 边转移到 new_target。

        如果转移后产生重复边（同一 source→new_target 同一 relation_type），
        保留原边并将重复边标记为 inactive。
        返回转移的边数。
        """
        # 查出需要转移的边
        result = await self.db.execute(
            select(Edge).where(
                and_(
                    Edge.target_node_id == old_target_id,
                    Edge.relation_type.in_(relation_types),
                    Edge.status == "active",
                )
            )
        )
        edges_to_move = result.scalars().all()

        moved = 0
        for edge in edges_to_move:
            # 检查是否已有相同的 source → new_target + relation_type 边
            dup_check = await self.db.execute(
                select(Edge).where(
                    and_(
                        Edge.source_node_id == edge.source_node_id,
                        Edge.target_node_id == new_target_id,
                        Edge.relation_type == edge.relation_type,
                        Edge.status == "active",
                    )
                )
            )
            if dup_check.scalar_one_or_none():
                # 已有相同边，标记这条为 inactive（丢弃）
                edge.status = "inactive"
            else:
                edge.target_node_id = new_target_id
                moved += 1

        await self.db.flush()
        return moved

    async def get_partition_children(self, partition_id: UUID) -> dict:
        """获取分区下的所有 topic 和 article 节点。"""
        result = await self.db.execute(
            select(Edge).where(
                and_(
                    Edge.target_node_id == partition_id,
                    Edge.relation_type.in_(["part_of", "belongs_to"]),
                    Edge.status == "active",
                )
            )
        )
        edges = result.scalars().all()
        child_ids = [e.source_node_id for e in edges]

        nodes = []
        if child_ids:
            node_result = await self.db.execute(
                select(Node).where(Node.id.in_(child_ids))
            )
            nodes = node_result.scalars().all()

        return {
            "topics": [self._node_to_dict(n) for n in nodes if n.node_type == "topic"],
            "articles": [self._node_to_dict(n) for n in nodes if n.node_type == "article"],
        }

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

    async def get_article_subgraph(
        self,
        article_id: UUID,
        include_proposition: bool = True,
    ) -> Optional[dict]:
        """获取 article 节点下属的 claim + proposition + 内部边。

        查询策略：通过 article.source_document_id 反查 document_id，
        再查所有共享该 source_document_id 的节点。
        """
        # Step 1: 拿 document_id
        art = await self.db.execute(
            select(Node.source_document_id).where(Node.id == article_id)
        )
        doc_id = art.scalar_one_or_none()
        if not doc_id:
            return None

        # Step 2: 查同 document 的知识节点（排除 article 自己）
        node_query = select(Node).where(
            and_(
                Node.source_document_id == doc_id,
                Node.id != article_id,
                Node.status == "active",
            )
        )
        if not include_proposition:
            node_query = node_query.where(Node.node_type != "proposition")

        nodes = (await self.db.execute(node_query)).scalars().all()
        node_ids = [n.id for n in nodes]

        # Step 3: 内部边
        edges = await self.get_edges_for_nodes(node_ids) if node_ids else []

        return {
            "article_id": str(article_id),
            "document_id": str(doc_id),
            "nodes": [self._node_to_dict(n) for n in nodes],
            "edges": edges,
        }

    def _node_to_dict(self, node: Node) -> dict:
        return {
            "id": str(node.id),
            "node_type": node.node_type,
            "name": node.name,
            "canonical_name": node.canonical_name,
            "description": node.description,
            "source_document_id": str(node.source_document_id) if node.source_document_id else None,
            "parent_node_id": str(node.parent_node_id) if node.parent_node_id else None,
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
