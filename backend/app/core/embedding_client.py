import hashlib
import logging
import struct
from typing import List, Optional

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 256


def _simple_hash_embedding(text: str, dim: int = EMBEDDING_DIM) -> List[float]:
    """Generate a deterministic pseudo-embedding from text hash.

    Used as fallback when no embedding API is available.
    NOT semantically meaningful — only works for exact-match retrieval.
    """
    h = hashlib.sha256(text.encode("utf-8")).digest()
    values = []
    for i in range(dim):
        # Cycle through hash bytes to fill dim
        byte_val = h[i % len(h)]
        # Map to [-1, 1]
        values.append((byte_val / 127.5) - 1.0)
    return values


class EmbeddingClient:
    """Async client for embedding APIs, with local hash fallback."""

    def __init__(self):
        settings = get_settings()
        self.base_url = settings.EMBEDDING_BASE_URL.rstrip("/")
        self.api_key = settings.EMBEDDING_API_KEY
        self.model = settings.EMBEDDING_MODEL
        self._client: Optional[httpx.AsyncClient] = None
        self._use_fallback = False

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def embed(self, text: str) -> List[float]:
        """Get embedding for a single text."""
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Get embeddings for multiple texts."""
        if not texts:
            return []

        if self._use_fallback:
            return [_simple_hash_embedding(t) for t in texts]

        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "input": texts,
                },
            )
            resp.raise_for_status()
            data = resp.json()

            # Sort by index to ensure order matches input
            embeddings = sorted(data["data"], key=lambda x: x["index"])
            return [item["embedding"] for item in embeddings]
        except Exception as e:
            logger.warning(
                f"Embedding API failed ({e}), falling back to hash embeddings. "
                "Semantic search will not work properly. Configure a real embedding API for production."
            )
            self._use_fallback = True
            return [_simple_hash_embedding(t) for t in texts]

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
