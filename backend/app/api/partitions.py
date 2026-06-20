"""API routes for partition management."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import (
    PartitionCreateRequest,
    PartitionUpdateRequest,
    PartitionMergeRequest,
    PartitionSplitRequest,
)
from ..services.partition_service import PartitionService
from ..services.merge_service import MergeService

logger = logging.getLogger(__name__)
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


@router.get("/partitions/{partition_id}/children")
async def get_partition_children(
    partition_id: str,
    db: AsyncSession = Depends(get_db),
):
    """获取分区下的所有 topic 和 article 节点。"""
    service = MergeService(db)
    result = await service.get_partition_children(partition_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Partition not found")
    return result


@router.post("/partitions/merge")
async def merge_partitions(
    data: PartitionMergeRequest,
    db: AsyncSession = Depends(get_db),
):
    """合并两个分区（source → target）。"""
    if data.source_id == data.target_id:
        raise HTTPException(status_code=400, detail="不能合并到自身")
    service = MergeService(db)
    try:
        return await service.merge_partitions(data.source_id, data.target_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Merge partitions failed: {e}")
        raise HTTPException(status_code=500, detail="合并失败")


@router.post("/partitions/{partition_id}/split")
async def split_partition(
    partition_id: str,
    data: PartitionSplitRequest,
    db: AsyncSession = Depends(get_db),
):
    """从分区中拆分部分 topic 到新分区。"""
    if not data.topic_ids:
        raise HTTPException(status_code=400, detail="请至少选择一个 topic")
    if not data.new_partition_name.strip():
        raise HTTPException(status_code=400, detail="新分区名不能为空")
    service = MergeService(db)
    try:
        return await service.split_partition(
            partition_id,
            data.topic_ids,
            data.new_partition_name,
            data.new_partition_description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Split partition failed: {e}")
        raise HTTPException(status_code=500, detail="拆分失败")
