"""Create database tables."""
import asyncio
from sqlalchemy import text
from app.database import engine, Base
from app.models.db_models import *  # noqa - registers all models with Base


async def init():
    async with engine.begin() as conn:
        # Create pgvector extension (required for <=> similarity operator)
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        print("pgvector extension ready!")
        await conn.run_sync(Base.metadata.create_all)
        print("Tables created successfully!")


if __name__ == "__main__":
    asyncio.run(init())
