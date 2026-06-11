import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.db_models import DraftGraph

logger = logging.getLogger(__name__)


class DraftGraphService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_draft_graph(self, draft_graph_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(DraftGraph).where(DraftGraph.id == draft_graph_id)
        )
        dg = result.scalar_one_or_none()
        if not dg:
            return None
        return {
            "id": str(dg.id),
            "document_id": str(dg.document_id),
            "graph_json": dg.graph_json,
            "status": dg.status,
        }

    async def update_draft_graph(self, draft_graph_id: str, graph_json: dict) -> Optional[dict]:
        result = await self.db.execute(
            select(DraftGraph).where(DraftGraph.id == draft_graph_id)
        )
        dg = result.scalar_one_or_none()
        if not dg:
            return None
        dg.graph_json = graph_json
        await self.db.flush()
        return {
            "id": str(dg.id),
            "document_id": str(dg.document_id),
            "graph_json": dg.graph_json,
            "status": dg.status,
        }

    async def confirm_draft_graph(self, draft_graph_id: str) -> dict:
        """Confirm a draft graph and generate a clustering proposal."""
        result = await self.db.execute(
            select(DraftGraph).where(DraftGraph.id == draft_graph_id)
        )
        dg = result.scalar_one_or_none()
        if not dg:
            return {"error": "Draft graph not found"}

        dg.status = "confirmed"
        await self.db.flush()

        # Generate clustering proposal using the new ClusteringService
        from .clustering_service import ClusteringService
        clustering = ClusteringService(self.db)
        proposal_result = await clustering.generate_proposal(
            document_id=str(dg.document_id),
            draft_graph_json=dg.graph_json,
        )

        if "error" in proposal_result:
            return {
                "draft_graph_id": str(dg.id),
                "status": "confirmed",
                "proposal_id": None,
                "error": proposal_result["error"],
            }

        return {
            "draft_graph_id": str(dg.id),
            "status": "confirmed",
            "proposal_id": proposal_result["proposal_id"],
        }
