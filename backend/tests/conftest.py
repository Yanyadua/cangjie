"""Test fixtures for Phase 2.

使用 SQLite in-memory + aiosqlite 避免依赖真实 PostgreSQL。
"""
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.db_models import Base


# -- SQLite 兼容 PostgreSQL 专用类型 ---------------------------------------
# 生产模型使用 sqlalchemy.dialects.postgresql.UUID / JSONB，SQLite 编译器
# 原生不支持这两种类型。这里通过 @compiles 注册编译钩子，让 SQLite 把它们
# 分别渲染为 String(36) 和 JSON，使测试可以用 SQLite in-memory 跑。
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):  # noqa: D401
    """PostgreSQL UUID → SQLite String(36)。"""
    return "VARCHAR(36)"


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: D401
    """PostgreSQL JSONB → SQLite JSON。"""
    return "JSON"


@pytest_asyncio.fixture
async def db_session():
    """提供隔离的 async db session，测试后自动清理。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session

    await engine.dispose()
