from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

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
