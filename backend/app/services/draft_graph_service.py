import logging
from uuid import uuid4
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.db_models import DraftGraph, InsertionProposal
from ..core.llm_client import LLMClient
from ..core.embedding_client import EmbeddingClient
from ..core.vector_store import VectorStore
from ..core.graph_store import GraphStore
from ..core.insertion_planner import InsertionPlanner

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

    async def confirm_draft_graph(self, draft_graph_id: str) -> Optional[dict]:
        """Confirm draft graph and trigger insertion planning."""
        result = await self.db.execute(
            select(DraftGraph).where(DraftGraph.id == draft_graph_id)
        )
        dg = result.scalar_one_or_none()
        if not dg:
            return None

        dg.status = "confirmed"
        await self.db.flush()

        # Trigger insertion planning
        try:
            llm = LLMClient()
            embedding = EmbeddingClient()
            vector_store = VectorStore(self.db)
            graph_store = GraphStore(self.db)
            planner = InsertionPlanner(llm)

            proposal_data = await planner.plan(
                document_id=dg.document_id,
                draft_graph=dg.graph_json,
                graph_store=graph_store,
                vector_store=vector_store,
                embedding_client=embedding,
                llm_client=llm,
            )

            # Save insertion proposal
            proposal = InsertionProposal(
                id=uuid4(),
                document_id=dg.document_id,
                proposal_json=proposal_data,
                status="pending",
            )
            self.db.add(proposal)
            await self.db.flush()

            return {
                "draft_graph_id": str(dg.id),
                "status": "confirmed",
                "proposal_id": str(proposal.id),
            }
        except Exception as e:
            logger.error(f"Insertion planning failed: {e}")
            # Still return confirmed status, proposal can be retried
            return {
                "draft_graph_id": str(dg.id),
                "status": "confirmed",
                "proposal_id": None,
                "error": str(e),
            }
