"""Create database tables."""
import asyncio
from app.database import engine, Base
from app.models.db_models import *  # noqa - registers all models with Base


async def init():
    async with engine.begin() as conn:
        # Create vector extension
        await conn.execute(Base.metadata.create_all)
        print("Tables created successfully!")


if __name__ == "__main__":
    asyncio.run(init())
