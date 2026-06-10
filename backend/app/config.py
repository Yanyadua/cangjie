from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/personal_kb"

    LLM_PROVIDER: str = "openai_compatible"
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_API_KEY: str = "your_api_key"
    LLM_MODEL: str = "gpt-4o-mini"

    EMBEDDING_PROVIDER: str = "openai_compatible"
    EMBEDDING_BASE_URL: str = "https://api.openai.com/v1"
    EMBEDDING_API_KEY: str = "your_api_key"
    EMBEDDING_MODEL: str = "text-embedding-3-small"

    VECTOR_STORE: str = "pgvector"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
