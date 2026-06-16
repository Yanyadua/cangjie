"""Service for merging/deduplicating nodes and partitions."""

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.graph_store import GraphStore
from ..core.embedding_client import EmbeddingClient
from ..core.vector_store import VectorStore
from ..models.db_models import Edge

logger = logging.getLogger(__name__)


class MergeService:
    """编排节点去重、分区合并、分区拆分。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_store = GraphStore(db)
        self.embedding = EmbeddingClient()
        self.vector_store = VectorStore(db)

    async def detect_duplicate_topics(self, threshold: float = 0.85) -> list[dict]:
        """检测全局图谱中语义相似的 topic 节点对。"""
        return await self.graph_store.detect_duplicate_topics(threshold)

    async def merge_nodes(self, source_id: str, target_id: str) -> dict:
        """将 source 节点合并到 target 节点。"""
        src_uuid = UUID(source_id)
        tgt_uuid = UUID(target_id)

        result = await self.graph_store.merge_nodes(src_uuid, tgt_uuid)

        try:
            await self.vector_store.delete("nodes", src_uuid)
        except Exception as e:
            logger.warning(f"Clear merged node embedding failed: {e}")

        await self.db.commit()
        return {"merged_into": str(result), "source_id": source_id}

    async def merge_partitions(self, source_id: str, target_id: str) -> dict:
        """合并分区 source → target。

        1. reassign_edges 转移 part_of/belongs_to 边（含重复检测）
        2. reassign_edges 转移 root 边（target 已有 root 边则标记 inactive）
        3. merge_nodes 处理残余边、别名、标记 merged
        """
        src_uuid = UUID(source_id)
        tgt_uuid = UUID(target_id)

        # 转移子节点边
        moved = await self.graph_store.reassign_edges(
            src_uuid, tgt_uuid, ["part_of", "belongs_to"]
        )
        # 转移 root 边（reassign 会自动检测并丢弃重复）
        await self.graph_store.reassign_edges(
            src_uuid, tgt_uuid, ["root"]
        )

        await self.graph_store.merge_nodes(src_uuid, tgt_uuid)

        try:
            await self.vector_store.delete("nodes", src_uuid)
        except Exception as e:
            logger.warning(f"Clear merged partition embedding failed: {e}")

        await self.db.commit()
        return {
            "merged_into": target_id,
            "source_id": source_id,
            "edges_moved": moved,
        }

    async def split_partition(
        self,
        source_partition_id: str,
        topic_ids: list[str],
        new_partition_name: str,
        new_partition_description: str = "",
    ) -> dict:
        """从分区中拆分部分 topic 到新分区。"""
        src_uuid = UUID(source_partition_id)

        me_id = await self.graph_store.ensure_me_node()
        new_partition_id = await self.graph_store.create_node(
            node_type="partition",
            name=new_partition_name.strip(),
            description=new_partition_description,
        )

        await self.graph_store.create_edge(
            source_id=me_id,
            target_id=new_partition_id,
            relation_type="root",
            confidence=1.0,
        )

        moved = 0
        for tid in topic_ids:
            topic_uuid = UUID(tid)
            result = await self.db.execute(
                select(Edge).where(
                    and_(
                        Edge.source_node_id == topic_uuid,
                        Edge.target_node_id == src_uuid,
                        Edge.relation_type == "part_of",
                        Edge.status == "active",
                    )
                )
            )
            edge = result.scalar_one_or_none()
            if edge:
                edge.target_node_id = new_partition_id
                moved += 1
            else:
                await self.graph_store.create_edge(
                    source_id=topic_uuid,
                    target_id=new_partition_id,
                    relation_type="part_of",
                    confidence=0.8,
                )
                moved += 1

        try:
            emb_text = f"{new_partition_name} {new_partition_description}".strip()
            emb = await self.embedding.embed(emb_text)
            await self.vector_store.upsert_node_embedding(new_partition_id, emb)
        except Exception as e:
            logger.warning(f"Split partition embedding failed: {e}")

        await self.db.commit()
        return {
            "new_partition_id": str(new_partition_id),
            "topic_count": len(topic_ids),
            "edges_moved": moved,
        }

    async def get_partition_children(self, partition_id: str) -> Optional[dict]:
        """获取分区下的所有 topic 和 article。"""
        return await self.graph_store.get_partition_children(UUID(partition_id))
