import logging
from uuid import uuid4
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.db_models import Document, Chunk, DraftGraph
from ..models.schemas import DocumentImport
from ..core.cleaner import clean_text, compute_content_hash
from ..core.chunker import TextChunker
from ..core.llm_client import LLMClient
from ..core.embedding_client import EmbeddingClient
from ..core.graph_extractor import GraphExtractor

logger = logging.getLogger(__name__)


class DocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.embedding = EmbeddingClient()
        self.chunker = TextChunker()

    async def import_document(self, data: DocumentImport) -> dict:
        """Import a document: clean, chunk, embed, extract draft graph."""
        # Clean content
        cleaned = clean_text(data.content)
        content_hash = compute_content_hash(data.content)

        # Save document
        doc = Document(
            id=uuid4(),
            title=data.title,
            source_type=data.source_type,
            source_url=data.source_url,
            author=data.author,
            raw_content=data.content,
            cleaned_content=cleaned,
            content_hash=content_hash,
            status="processing",
        )
        self.db.add(doc)
        await self.db.flush()

        # Chunk
        chunks_text = self.chunker.chunk(cleaned)
        chunk_records = []
        for i, chunk_text in enumerate(chunks_text):
            chunk = Chunk(
                id=uuid4(),
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text,
                content_hash=compute_content_hash(chunk_text),
                token_count=len(chunk_text),
            )
            self.db.add(chunk)
            chunk_records.append(chunk)
        await self.db.flush()

        # Generate embeddings for chunks
        try:
            chunk_texts = [c.content for c in chunk_records]
            chunk_embs = await self.embedding.embed_batch(chunk_texts)
            for chunk, emb in zip(chunk_records, chunk_embs):
                emb_str = "[" + ",".join(str(v) for v in emb) + "]"
                chunk.embedding = emb_str
            await self.db.flush()
        except Exception as e:
            logger.warning(f"Chunk embedding failed: {e}")

        # Mark as ready for extraction (graph extraction is now done via extraction wizard)
        doc.status = "ready"

        await self.db.flush()

        return {
            "document_id": str(doc.id),
        }

    async def get_documents(self, skip: int = 0, limit: int = 20) -> dict:
        result = await self.db.execute(
            select(Document).order_by(Document.created_at.desc()).offset(skip).limit(limit)
        )
        docs = result.scalars().all()

        count_result = await self.db.execute(select(Document))
        total = len(count_result.scalars().all())

        return {
            "documents": [
                {
                    "id": str(d.id),
                    "title": d.title,
                    "source_type": d.source_type,
                    "source_url": d.source_url,
                    "author": d.author,
                    "summary": d.summary,
                    "status": d.status,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in docs
            ],
            "total": total,
        }

    async def get_document(self, document_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return None
        return {
            "id": str(doc.id),
            "title": doc.title,
            "source_type": doc.source_type,
            "source_url": doc.source_url,
            "author": doc.author,
            "raw_content": doc.raw_content,
            "cleaned_content": doc.cleaned_content,
            "content_hash": doc.content_hash,
            "summary": doc.summary,
            "status": doc.status,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        }
