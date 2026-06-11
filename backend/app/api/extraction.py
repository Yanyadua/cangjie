from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.extraction_service import ExtractionService

router = APIRouter()


@router.get("/extraction/{document_id}/status")
async def get_extraction_status(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    return await svc.get_status(document_id)


@router.post("/extraction/{document_id}/stage1")
async def run_stage1(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_stage1(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/stage1")
async def save_stage1(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_stage1(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/stage2")
async def run_stage2(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_stage2(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/stage2")
async def save_stage2(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_stage2(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/stage3")
async def run_stage3(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_stage3(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/stage3")
async def save_stage3(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_stage3(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/finalize")
async def finalize_extraction(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.finalize(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
