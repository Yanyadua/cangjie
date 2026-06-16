import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.extraction_service import ExtractionService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/extraction/{document_id}/status")
async def get_extraction_status(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    return await svc.get_status(document_id)


@router.post("/extraction/{document_id}/step1")
async def run_step1(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_step1(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/step1")
async def save_step1(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_step1(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/step2")
async def run_step2(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_step2(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/extraction/{document_id}/step2/stream")
async def stream_step2(document_id: str, db: AsyncSession = Depends(get_db)):
    """Stream step2 expand via SSE, saving the result when done."""
    svc = ExtractionService(db)

    async def event_generator():
        try:
            async for event, data in svc.run_step2_stream(document_id):
                payload = {"type": event, "text": data} if event == "chunk" else {"type": event, "result": data} if event == "done" else {"type": "error", "message": data}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                if event == "error":
                    return
        except Exception as exc:
            logger.exception("Stream step2 error")
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.put("/extraction/{document_id}/step2")
async def save_step2(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_step2(document_id, data)
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
