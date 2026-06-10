from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import DraftGraphUpdateRequest
from ..services.draft_graph_service import DraftGraphService

router = APIRouter()


@router.get("/documents/{document_id}/draft-graph")
async def get_draft_graph_by_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from ..models.db_models import DraftGraph
    result = await db.execute(
        select(DraftGraph)
        .where(DraftGraph.document_id == document_id)
        .order_by(DraftGraph.created_at.desc())
        .limit(1)
    )
    dg = result.scalar_one_or_none()
    if not dg:
        raise HTTPException(status_code=404, detail="Draft graph not found for this document")
    return {
        "id": str(dg.id),
        "document_id": str(dg.document_id),
        "graph_json": dg.graph_json,
        "status": dg.status,
    }


@router.get("/draft-graphs/{draft_graph_id}")
async def get_draft_graph(
    draft_graph_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DraftGraphService(db)
    result = await service.get_draft_graph(draft_graph_id)
    if not result:
        raise HTTPException(status_code=404, detail="Draft graph not found")
    return result


@router.put("/draft-graphs/{draft_graph_id}")
async def update_draft_graph(
    draft_graph_id: str,
    data: DraftGraphUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = DraftGraphService(db)
    result = await service.update_draft_graph(draft_graph_id, data.graph_json.model_dump())
    if not result:
        raise HTTPException(status_code=404, detail="Draft graph not found")
    return result


@router.post("/draft-graphs/{draft_graph_id}/confirm")
async def confirm_draft_graph(
    draft_graph_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DraftGraphService(db)
    result = await service.confirm_draft_graph(draft_graph_id)
    if not result:
        raise HTTPException(status_code=404, detail="Draft graph not found")
    return result
