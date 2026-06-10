from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import AskRequest
from ..services.qa_service import QAService

router = APIRouter()


@router.post("/qa/ask")
async def ask_question(
    data: AskRequest,
    db: AsyncSession = Depends(get_db),
):
    service = QAService(db)
    return await service.ask(data.question)
