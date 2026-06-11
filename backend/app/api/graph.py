from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.graph_store import GraphStore
from ..database import get_db
from ..services.graph_service import GraphService

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
    """Get the full global graph or filter by node type (topic/article)."""
    store = GraphStore(db)
    all_nodes = await store.get_all_active_nodes()

    if filter_type == "topic":
        nodes = [n for n in all_nodes if n["node_type"] == "topic"]
    elif filter_type == "article":
        nodes = [n for n in all_nodes if n["node_type"] == "article"]
    else:
        nodes = [n for n in all_nodes if n["node_type"] in ("topic", "article")]

    node_ids = [UUID(n["id"]) for n in nodes]
    edges = await store.get_edges_for_nodes(node_ids) if node_ids else []

    return {"nodes": nodes, "edges": edges}
