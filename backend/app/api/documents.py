from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import DocumentImport
from ..services.document_service import DocumentService

router = APIRouter()


@router.post("/documents/import")
async def import_document(
    data: DocumentImport,
    db: AsyncSession = Depends(get_db),
):
    service = DocumentService(db)
    result = await service.import_document(data)
    return result


@router.get("/documents")
async def list_documents(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    service = DocumentService(db)
    return await service.get_documents(skip=skip, limit=limit)


@router.get("/documents/{document_id}")
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DocumentService(db)
    result = await service.get_document(document_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    return result
