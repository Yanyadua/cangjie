from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import InsertionProposalUpdateRequest
from ..services.insertion_service import InsertionService

router = APIRouter()


@router.get("/insertion-proposals/{proposal_id}")
async def get_insertion_proposal(
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = InsertionService(db)
    result = await service.get_proposal(proposal_id)
    if not result:
        raise HTTPException(status_code=404, detail="Insertion proposal not found")
    return result


@router.put("/insertion-proposals/{proposal_id}")
async def update_insertion_proposal(
    proposal_id: str,
    data: InsertionProposalUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = InsertionService(db)
    result = await service.update_proposal(proposal_id, data.proposal_json.model_dump())
    if not result:
        raise HTTPException(status_code=404, detail="Insertion proposal not found")
    return result


@router.post("/insertion-proposals/{proposal_id}/apply")
async def apply_insertion_proposal(
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = InsertionService(db)
    result = await service.apply_proposal(proposal_id)
    if not result:
        raise HTTPException(status_code=404, detail="Insertion proposal not found")
    return result
