from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.graph_store import GraphStore
from ..database import get_db
from ..models.schemas import NodeMergeRequest
from ..services.graph_service import GraphService
from ..services.merge_service import MergeService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/graph/local")
async def get_local_graph(
    node_id: str,
    hops: int = 1,
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    result = await service.get_local_graph(node_id, hops=hops)
    if not result:
        raise HTTPException(status_code=404, detail="Node not found or no neighbors")
    return result


@router.get("/graph/nodes/{node_id}")
async def get_node_detail(
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = GraphService(db)
    result = await service.get_node_detail(node_id)
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/graph/global")
async def get_global_graph(
    filter_type: str = "all",
    db: AsyncSession = Depends(get_db),
):
    """Get the full global graph or filter by node type."""
    store = GraphStore(db)
    all_nodes = await store.get_all_active_nodes()

    if filter_type == "topic":
        nodes = [n for n in all_nodes if n["node_type"] == "topic"]
    elif filter_type == "article":
        nodes = [n for n in all_nodes if n["node_type"] == "article"]
    elif filter_type == "partition":
        # 分区视图：展示 我 + 分区 + topic + article 的层级结构
        nodes = [
            n for n in all_nodes
            if n["node_type"] in ("person", "partition", "topic", "article")
        ]
    else:
        nodes = [n for n in all_nodes if n["node_type"] in ("topic", "article")]

    node_ids = [UUID(n["id"]) for n in nodes]
    edges = await store.get_edges_for_nodes(node_ids) if node_ids else []

    return {"nodes": nodes, "edges": edges}


@router.get("/graph/duplicates")
async def detect_duplicates(
    threshold: float = 0.85,
    db: AsyncSession = Depends(get_db),
):
    """检测全局图谱中语义相似的 topic 节点对。"""
    service = MergeService(db)
    return await service.detect_duplicate_topics(threshold)


@router.post("/graph/nodes/merge")
async def merge_nodes(
    data: NodeMergeRequest,
    db: AsyncSession = Depends(get_db),
):
    """合并两个节点（source → target）。"""
    if data.source_id == data.target_id:
        raise HTTPException(status_code=400, detail="不能合并到自身")
    service = MergeService(db)
    try:
        return await service.merge_nodes(data.source_id, data.target_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Merge nodes failed: {e}")
        raise HTTPException(status_code=500, detail="合并失败")


@router.get("/graph/article/{article_id}")
async def get_article_subgraph(
    article_id: str,
    include_proposition: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """返回某篇文章的 claim + proposition 子图（含内部边）。

    用于全局宏观图点 article 节点后的下钻视图。
    """
    store = GraphStore(db)
    try:
        aid = UUID(article_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid article_id")
    result = await store.get_article_subgraph(aid, include_proposition=include_proposition)
    if not result:
        raise HTTPException(status_code=404, detail="Article not found")
    return result
