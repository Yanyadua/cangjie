import json
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from ..models.db_models import Document, Chunk, DraftGraph
from ..core.cleaner import clean_text, compute_content_hash
from ..core.chunker import TextChunker
from ..core.llm_client import LLMClient
from ..core.embedding_client import EmbeddingClient
from ..core.graph_extractor import GraphExtractor

logger = logging.getLogger(__name__)


class ExtractionService:
    """Manage the multi-stage extraction pipeline with user review between stages."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.extractor = GraphExtractor(self.llm)

    async def _get_doc_content(self, document_id: str) -> Optional[tuple[str, str]]:
        result = await self.db.execute(select(Document).where(Document.id == document_id))
        doc = result.scalar_one_or_none()
        if not doc:
            return None
        return doc.title, doc.cleaned_content or doc.raw_content

    async def _get_or_create_session(self, document_id: str) -> dict:
        """Get existing extraction session or create a new one."""
        result = await self.db.execute(
            select(DraftGraph)
            .where(DraftGraph.document_id == document_id)
            .order_by(DraftGraph.created_at.desc())
            .limit(1)
        )
        dg = result.scalar_one_or_none()
        if dg:
            return {"id": str(dg.id), "document_id": str(dg.document_id), "graph_json": dg.graph_json, "status": dg.status}
        return None

    # ── Step 1: Skeleton (summary + topic tags + core claims) ──

    async def run_step1(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        result = await self.extractor.run_skeleton(title, content)

        from uuid import uuid4
        dg = DraftGraph(
            id=uuid4(),
            document_id=document_id,
            graph_json={"step": 1, "skeleton": result},
            status="skeleton",
        )
        self.db.add(dg)
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 1, "data": result}

    async def save_step1(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found. Run step1 first."}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["skeleton"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "skeleton_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 1, "status": "saved"}

    # ── Step 2: Expand skeleton into full graph ──

    async def run_step2(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "skeleton" not in session.get("graph_json", {}):
            return {"error": "Step 1 not completed. Run step1 first."}

        skeleton = session["graph_json"]["skeleton"]
        result = await self.extractor.run_expand(title, content, skeleton)

        result_db = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result_db.scalar_one()
        gj = dg.graph_json
        gj["step"] = 2
        gj["expanded"] = result
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "expanded"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 2, "data": result}

    async def save_step2(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found"}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["expanded"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "expanded_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 2, "status": "saved"}

    # ── Finalize: Validate + Create Draft Graph ──

    async def finalize(self, document_id: str) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session or "expanded" not in session.get("graph_json", {}):
            return {"error": "Extraction not completed. Complete step2 first."}

        gj = session["graph_json"]
        skeleton = gj.get("skeleton", {})
        expanded = gj.get("expanded", {})

        summary = skeleton.get("summary", "")
        nodes = expanded.get("nodes", [])
        edges = expanded.get("edges", [])

        content = (await self._get_doc_content(document_id))[1]

        # Run evidence validation
        await self.extractor.validate_evidence(edges, content)

        # Calibrate confidence
        from ..core.graph_extractor import _calibrate_confidence
        edges = _calibrate_confidence(edges, content)

        # Validate and sanitize
        from ..core.graph_extractor import _validate_and_sanitize
        final = _validate_and_sanitize({"summary": summary, "nodes": nodes, "edges": edges})

        # Update draft graph
        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        dg.graph_json = final
        dg.status = "draft"
        await self.db.flush()

        return {"draft_graph_id": str(dg.id), "status": "draft", "graph_json": final}

    # ── Get Status ──

    async def get_status(self, document_id: str) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"step": 0, "document_id": document_id}

        gj = session.get("graph_json", {})
        return {
            "session_id": session["id"],
            "document_id": document_id,
            "step": gj.get("step", 0),
            "status": session["status"],
            "skeleton": gj.get("skeleton"),
            "expanded": gj.get("expanded"),
        }
