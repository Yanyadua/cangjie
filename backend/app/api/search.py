from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import SemanticSearchRequest, GraphEnhancedSearchRequest
from ..services.search_service import SearchService

router = APIRouter()


@router.post("/search/semantic")
async def semantic_search(
    data: SemanticSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    service = SearchService(db)
    return await service.semantic_search(data.query, top_k=data.top_k)


@router.post("/search/graph-enhanced")
async def graph_enhanced_search(
    data: GraphEnhancedSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    service = SearchService(db)
    return await service.graph_enhanced_search(data.query, top_k=data.top_k)
