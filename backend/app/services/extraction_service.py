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

    # ── Stage 1: Summary + Core Concepts ──

    async def run_stage1(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        result = await self.extractor.run_stage1(title, content)

        # Store in draft_graphs with status "stage1"
        from uuid import uuid4
        dg = DraftGraph(
            id=uuid4(),
            document_id=document_id,
            graph_json={"stage": 1, "stage1": result},
            status="stage1",
        )
        self.db.add(dg)
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 1, "data": result}

    async def save_stage1(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found. Run stage1 first."}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["stage1"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "stage1_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 1, "status": "saved"}

    # ── Stage 2: Entity & Claim Nodes ──

    async def run_stage2(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "stage1" not in session.get("graph_json", {}):
            return {"error": "Stage 1 not completed. Run stage1 first."}

        stage1_data = session["graph_json"]["stage1"]
        result = await self.extractor.run_stage2(title, content, stage1_data)

        # Save
        result_db = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result_db.scalar_one()
        gj = dg.graph_json
        gj["stage"] = 2
        gj["stage2"] = result
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "stage2"
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 2, "data": result}

    async def save_stage2(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found"}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["stage2"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "stage2_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 2, "status": "saved"}

    # ── Stage 3: Relationships ──

    async def run_stage3(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "stage2" not in session.get("graph_json", {}):
            return {"error": "Stage 2 not completed. Run stage2 first."}

        stage2_data = session["graph_json"]["stage2"]
        result = await self.extractor.run_stage3(content, stage2_data)

        # Save
        result_db = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result_db.scalar_one()
        gj = dg.graph_json
        gj["stage"] = 3
        gj["stage3"] = result
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "stage3"
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 3, "data": result}

    async def save_stage3(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found"}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["stage3"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "stage3_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "stage": 3, "status": "saved"}

    # ── Finalize: Validate + Create Draft Graph ──

    async def finalize(self, document_id: str) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session or "stage2" not in session.get("graph_json", {}):
            return {"error": "Extraction not completed. Complete all stages first."}

        gj = session["graph_json"]
        stage1 = gj.get("stage1", {})
        stage2 = gj.get("stage2", {})
        stage3 = gj.get("stage3", {})

        summary = stage1.get("summary", "")
        nodes = stage2.get("nodes", [])
        edges = stage3.get("edges", [])

        # Run evidence validation
        await self.extractor.validate_evidence(edges, (await self._get_doc_content(document_id))[1])

        # Calibrate confidence
        from ..core.graph_extractor import _calibrate_confidence
        edges = _calibrate_confidence(edges, (await self._get_doc_content(document_id))[1])

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
            return {"stage": 0, "document_id": document_id}

        gj = session.get("graph_json", {})
        return {
            "session_id": session["id"],
            "document_id": document_id,
            "stage": gj.get("stage", 0),
            "status": session["status"],
            "stage1": gj.get("stage1"),
            "stage2": gj.get("stage2"),
            "stage3": gj.get("stage3"),
        }
