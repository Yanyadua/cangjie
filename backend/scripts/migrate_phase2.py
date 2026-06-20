"""Phase 2 migration: add parent_node_id to nodes.

Idempotent: 安全重复执行。使用部分索引只为 proposition 行建索引。
"""
import asyncio
from sqlalchemy import text
from app.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE nodes "
            "ADD COLUMN IF NOT EXISTS parent_node_id UUID REFERENCES nodes(id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_nodes_parent_node_id "
            "ON nodes(parent_node_id) WHERE parent_node_id IS NOT NULL"
        ))
        print("Phase 2 migration done: parent_node_id column + partial index added.")


if __name__ == "__main__":
    asyncio.run(migrate())
