"""API routes for graph evaluation."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import EvaluationRunRequest
from ..services.evaluation_service import EvaluationService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/evaluation/run")
async def run_evaluation(
    data: EvaluationRunRequest,
    db: AsyncSession = Depends(get_db),
):
    """运行图谱质量评估。"""
    service = EvaluationService(db)
    try:
        result = await service.run_evaluation(data.document_id, data.strategies)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        raise HTTPException(status_code=500, detail="评估失败")
