"""API routes for partition management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import PartitionCreateRequest, PartitionUpdateRequest
from ..services.partition_service import PartitionService

router = APIRouter()


@router.get("/partitions")
async def list_partitions(db: AsyncSession = Depends(get_db)):
    service = PartitionService(db)
    return await service.list_partitions()


@router.post("/partitions")
async def create_partition(
    data: PartitionCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    return await service.create_partition(data.name, data.description)


@router.put("/partitions/{partition_id}")
async def update_partition(
    partition_id: str,
    data: PartitionUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    result = await service.update_partition(partition_id, data.name, data.description)
    if not result:
        raise HTTPException(status_code=404, detail="Partition not found")
    return result


@router.delete("/partitions/{partition_id}")
async def delete_partition(
    partition_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    result = await service.delete_partition(partition_id)
    if not result:
        raise HTTPException(status_code=404, detail="Partition not found")
    return result
