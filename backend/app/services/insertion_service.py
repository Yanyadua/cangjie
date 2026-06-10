import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.db_models import InsertionProposal, GraphPatch
from ..core.graph_store import GraphStore
from ..core.patch_validator import PatchValidator
from ..core.graph_patch import GraphPatcher

logger = logging.getLogger(__name__)


class InsertionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_proposal(self, proposal_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        proposal = result.scalar_one_or_none()
        if not proposal:
            return None
        return {
            "id": str(proposal.id),
            "document_id": str(proposal.document_id),
            "proposal_json": proposal.proposal_json,
            "status": proposal.status,
        }

    async def update_proposal(self, proposal_id: str, proposal_json: dict) -> Optional[dict]:
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        proposal = result.scalar_one_or_none()
        if not proposal:
            return None
        proposal.proposal_json = proposal_json
        await self.db.flush()
        return {
            "id": str(proposal.id),
            "document_id": str(proposal.document_id),
            "proposal_json": proposal.proposal_json,
            "status": proposal.status,
        }

    async def apply_proposal(self, proposal_id: str) -> Optional[dict]:
        """Apply insertion proposal: generate patch, validate, and apply."""
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        proposal = result.scalar_one_or_none()
        if not proposal:
            return None

        graph_store = GraphStore(self.db)
        patcher = GraphPatcher()

        # Generate patch from proposal
        patch_data = patcher.generate_patch(
            proposal=proposal.proposal_json,
            confirmed_graph={},
        )

        # Validate patch
        validator = PatchValidator()
        existing_nodes = set()
        try:
            all_nodes = await graph_store.get_all_active_nodes()
            existing_nodes = {n["id"] for n in all_nodes}
        except Exception:
            logger.warning("Could not fetch existing nodes for validation")

        existing_edges = set()
        try:
            edges = await graph_store.get_edges_for_nodes(list(existing_nodes))
            existing_edges = {(e["source"], e["target"], e["relation_type"]) for e in edges}
        except Exception:
            pass

        is_valid, errors = validator.validate(patch_data, existing_nodes, existing_edges)
        if not is_valid:
            return {
                "status": "validation_failed",
                "errors": errors,
            }

        # Apply patch
        try:
            apply_result = await patcher.apply_patch(patch_data, graph_store)
        except Exception as e:
            logger.error(f"Patch application failed: {e}")
            return {
                "status": "apply_failed",
                "error": str(e),
            }

        # Record patch
        from uuid import uuid4
        from datetime import datetime
        patch_record = GraphPatch(
            id=uuid4(),
            document_id=proposal.document_id,
            patch_type="insertion",
            operations=patch_data.get("operations", []),
            status="applied",
            applied_at=datetime.utcnow(),
        )
        self.db.add(patch_record)

        # Update proposal status
        proposal.status = "applied"
        await self.db.flush()

        return {
            "status": "applied",
            "patch_id": str(patch_record.id),
            "operations_count": len(patch_data.get("operations", [])),
            "apply_result": apply_result,
        }
