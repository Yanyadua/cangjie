"""API routes for clustering proposals."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.clustering_service import ClusteringService

router = APIRouter()


@router.get("/clustering-proposals/{proposal_id}")
async def get_clustering_proposal(proposal_id: str, db: AsyncSession = Depends(get_db)):
    service = ClusteringService(db)
    result = await service.get_proposal(proposal_id)
    if not result:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return result


@router.put("/clustering-proposals/{proposal_id}")
async def update_clustering_proposal(
    proposal_id: str,
    proposal_json: dict,
    db: AsyncSession = Depends(get_db),
):
    service = ClusteringService(db)
    result = await service.update_proposal(proposal_id, proposal_json)
    if not result:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return result


@router.post("/clustering-proposals/{proposal_id}/apply")
async def apply_clustering_proposal(proposal_id: str, db: AsyncSession = Depends(get_db)):
    service = ClusteringService(db)
    result = await service.apply_proposal(proposal_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
