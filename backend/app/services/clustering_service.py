"""Service for managing clustering proposals and applying them to the global graph."""

import json
import logging
from uuid import uuid4
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from ..models.db_models import InsertionProposal, Document
from ..core.llm_client import LLMClient
from ..core.embedding_client import EmbeddingClient
from ..core.clustering_planner import ClusteringPlanner
from ..core.vector_store import VectorStore
from ..core.graph_store import GraphStore

logger = logging.getLogger(__name__)


class ClusteringService:
    """Orchestrate tag generation, clustering proposal, and application."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.embedding = EmbeddingClient()
        self.vector_store = VectorStore(db)
        self.graph_store = GraphStore(db)
        self.planner = ClusteringPlanner(
            self.llm, self.embedding, self.vector_store, self.graph_store
        )

    async def generate_proposal(self, document_id: str, draft_graph_json: dict) -> dict:
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return {"error": "Document not found"}

        title = doc.title
        summary = draft_graph_json.get("summary", doc.summary or "")

        # Reuse topic_tags from extraction skeleton (no separate LLM call)
        tags = [
            {"name": t["name"], "confidence": t.get("confidence", 0.8)}
            for t in draft_graph_json.get("topic_tags", [])
        ]

        if not tags:
            # Fallback: extract topic-type nodes from the graph as tags
            for node in draft_graph_json.get("nodes", []):
                if node.get("node_type") == "topic":
                    tags.append({"name": node["name"], "confidence": 0.8})

        if not tags:
            return {"error": "No topic tags found. Complete extraction first."}

        # 分区匹配
        partition_action = await self.planner.match_partition(title, summary, tags)

        proposal = await self.planner.generate_proposal(
            article_title=title,
            article_summary=summary,
            tags=tags,
            document_id=document_id,
        )

        # 注入 partition_action
        proposal["partition_action"] = partition_action

        db_proposal = InsertionProposal(
            id=uuid4(),
            document_id=document_id,
            proposal_json=proposal,
            status="pending",
        )
        self.db.add(db_proposal)
        await self.db.flush()

        return {
            "proposal_id": str(db_proposal.id),
            "proposal_json": proposal,
        }

    async def get_proposal(self, proposal_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return None
        return {
            "id": str(prop.id),
            "document_id": str(prop.document_id),
            "proposal_json": prop.proposal_json,
            "status": prop.status,
        }

    async def update_proposal(self, proposal_id: str, proposal_json: dict) -> Optional[dict]:
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return None

        prop.proposal_json = json.loads(json.dumps(proposal_json))
        flag_modified(prop, "proposal_json")
        await self.db.flush()

        return {
            "id": str(prop.id),
            "document_id": str(prop.document_id),
            "proposal_json": prop.proposal_json,
            "status": prop.status,
        }

    async def apply_proposal(self, proposal_id: str) -> dict:
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return {"error": "Proposal not found"}

        proposal = prop.proposal_json
        document_id = proposal["document_id"]
        from uuid import UUID
        if isinstance(document_id, str):
            document_id = UUID(document_id)
        partition_action = proposal.get("partition_action", {})
        tag_actions = proposal.get("tag_actions", [])
        topic_edges = proposal.get("topic_edges", [])

        tag_to_topic_id: dict[str, str] = {}
        applied = []
        failed = []

        # ── 处理分区归属 ──
        partition_id = None
        if partition_action:
            me_id = await self.graph_store.ensure_me_node()

            if partition_action.get("action") == "NEW":
                pname = partition_action.get("proposed_name", "").strip()
                pdesc = partition_action.get("proposed_description", "")
                if pname:
                    try:
                        partition_id = await self.graph_store.create_node(
                            node_type="partition",
                            name=pname,
                            description=pdesc,
                        )
                        await self.graph_store.create_edge(
                            source_id=me_id,
                            target_id=partition_id,
                            relation_type="root",
                            confidence=1.0,
                        )
                        try:
                            emb = await self.embedding.embed(f"{pname} {pdesc}".strip())
                            await self.vector_store.upsert_node_embedding(partition_id, emb)
                        except Exception as e:
                            logger.warning(f"New partition embedding failed: {e}")
                        applied.append(f"NEW partition: {pname}")
                    except Exception as e:
                        failed.append(f"New partition creation: {e}")
            elif partition_action.get("action") == "MATCH":
                target_id = partition_action.get("target_partition_id")
                if target_id:
                    try:
                        from uuid import UUID
                        partition_id = UUID(target_id)
                        applied.append(f"MATCH partition: {partition_action.get('target_partition_name', '')}")
                    except Exception as e:
                        failed.append(f"Partition match: {e}")

        for action in tag_actions:
            try:
                if action["action"] == "NEW":
                    topic_id = await self.graph_store.create_node(
                        node_type="topic",
                        name=action["tag_name"],
                        description=action.get("proposed_description", ""),
                    )
                    try:
                        emb = await self.embedding.embed(action["tag_name"])
                        await self.vector_store.upsert_node_embedding(topic_id, emb)
                    except Exception as e:
                        logger.warning(f"Topic embedding failed: {e}")
                    # topic --part_of--> partition
                    if partition_id:
                        try:
                            await self.graph_store.create_edge(
                                source_id=topic_id,
                                target_id=partition_id,
                                relation_type="part_of",
                                confidence=0.8,
                            )
                        except Exception as e:
                            logger.warning(f"Topic part_of partition failed: {e}")
                    tag_to_topic_id[action["tag_name"]] = str(topic_id)
                    applied.append(f"NEW topic: {action['tag_name']}")
                elif action["action"] == "MERGE" and action.get("target_topic_id"):
                    tag_to_topic_id[action["tag_name"]] = action["target_topic_id"]
                    applied.append(f"MERGE tag '{action['tag_name']}' -> existing topic")
            except Exception as e:
                failed.append(f"Tag '{action['tag_name']}': {e}")
                logger.error(f"Failed to process tag action: {e}")

        try:
            article_id = await self.graph_store.create_node(
                node_type="article",
                name=proposal.get("article_title", "Untitled"),
                description=proposal.get("article_summary", ""),
                source_document_id=document_id,
            )
            try:
                emb = await self.embedding.embed(
                    proposal.get("article_summary", proposal.get("article_title", ""))
                )
                await self.vector_store.upsert_node_embedding(article_id, emb)
            except Exception as e:
                logger.warning(f"Article embedding failed: {e}")
            applied.append(f"NEW article node: {proposal.get('article_title')}")
        except Exception as e:
            failed.append(f"Article node creation: {e}")
            return {"error": "Failed to create article node", "details": str(e), "applied": applied, "failed": failed}

        # article --belongs_to--> partition
        if partition_id:
            try:
                await self.graph_store.create_edge(
                    source_id=article_id,
                    target_id=partition_id,
                    relation_type="belongs_to",
                    confidence=1.0,
                    evidence_document_id=document_id,
                )
                applied.append("EDGE article -> partition (belongs_to)")
            except Exception as e:
                failed.append(f"Article belongs_to partition: {e}")

        for tag_name, topic_id in tag_to_topic_id.items():
            try:
                await self.graph_store.create_edge(
                    source_id=article_id,
                    target_id=topic_id,
                    relation_type="tag",
                    confidence=1.0,
                    evidence_document_id=document_id,
                )
                applied.append(f"EDGE article -> {tag_name}")
            except Exception as e:
                failed.append(f"Edge article->{tag_name}: {e}")

        for edge in topic_edges:
            source_tag = edge.get("source_tag", "")
            target_tag = edge.get("target_tag", "")
            source_id = tag_to_topic_id.get(source_tag)
            target_id = tag_to_topic_id.get(target_tag)

            if source_id and target_id and source_id != target_id:
                try:
                    from uuid import UUID
                    await self.graph_store.create_edge(
                        source_id=UUID(source_id),
                        target_id=UUID(target_id),
                        relation_type=edge.get("relation_type", "related_to"),
                        confidence=0.8,
                    )
                    applied.append(f"EDGE topic {source_tag} --{edge.get('relation_type')}--> {target_tag}")
                except Exception as e:
                    failed.append(f"Topic edge {source_tag}->{target_tag}: {e}")

        # ── Phase 2: 知识节点入库（claim / proposition / concept 等）──
        import os
        knowledge_ingest = os.getenv("PHASE2_KNOWLEDGE_INGEST", "true") == "true"

        knowledge_counts: dict = {}
        knowledge_edges_created = 0

        if knowledge_ingest:
            from ..models.db_models import DraftGraph
            dg_result = await self.db.execute(
                select(DraftGraph).where(
                    DraftGraph.document_id == document_id
                ).order_by(DraftGraph.updated_at.desc()).limit(1)
            )
            draft = dg_result.scalar_one_or_none()
            if draft:
                draft_graph = draft.graph_json
                temp_to_uuid: dict = {}

                raw_nodes = draft_graph.get("nodes", [])
                skip_types = {"topic", "article"}  # 这些上游已处理

                # Pass 1: 非 proposition 节点（claim/concept/method/...）
                for n in raw_nodes:
                    ntype = n.get("node_type")
                    if ntype in skip_types or ntype == "proposition":
                        continue
                    temp_id = n.get("temp_id")
                    if not temp_id:
                        continue
                    try:
                        node_uuid = await self.graph_store.create_node(
                            node_type=ntype,
                            name=str(n.get("name", "")),
                            description=str(n.get("description", "")),
                            source_document_id=document_id,
                        )
                        temp_to_uuid[temp_id] = node_uuid
                        knowledge_counts[ntype] = knowledge_counts.get(ntype, 0) + 1
                        # claim 生成 embedding（失败不阻塞）
                        if ntype == "claim":
                            try:
                                emb = await self.embedding.embed(
                                    str(n.get("description") or n.get("name", ""))
                                )
                                await self.vector_store.upsert_node_embedding(node_uuid, emb)
                            except Exception as e:
                                logger.warning(f"Claim embedding failed: {e}")
                    except Exception as e:
                        failed.append(f"Node '{temp_id}': {e}")

                # Pass 2: proposition 节点（依赖 parent claim 已入库）
                for n in raw_nodes:
                    if n.get("node_type") != "proposition":
                        continue
                    temp_id = n.get("temp_id")
                    parent_temp = n.get("parent_claim_id")
                    parent_uuid = temp_to_uuid.get(parent_temp) if parent_temp else None
                    if not temp_id:
                        continue
                    try:
                        node_uuid = await self.graph_store.create_node(
                            node_type="proposition",
                            name=str(n.get("name", "")),
                            description=str(n.get("description", "")),
                            source_document_id=document_id,
                            parent_node_id=parent_uuid,
                        )
                        temp_to_uuid[temp_id] = node_uuid
                        knowledge_counts["proposition"] = knowledge_counts.get("proposition", 0) + 1
                    except Exception as e:
                        failed.append(f"Proposition '{temp_id}': {e}")

                # Pass 3: 知识边（两端都是知识节点）
                for e in draft_graph.get("edges", []):
                    src_temp = e.get("source")
                    tgt_temp = e.get("target")
                    src_uuid = temp_to_uuid.get(src_temp)
                    tgt_uuid = temp_to_uuid.get(tgt_temp)
                    if not src_uuid or not tgt_uuid:
                        continue
                    try:
                        await self.graph_store.create_edge(
                            source_id=src_uuid,
                            target_id=tgt_uuid,
                            relation_type=e.get("relation_type", "related_to"),
                            confidence=float(e.get("confidence", 0.8)),
                            evidence_document_id=document_id,
                            evidence_text=str(e.get("evidence", "")),
                        )
                        knowledge_edges_created += 1
                    except Exception as e_err:
                        failed.append(f"Edge {src_temp}->{tgt_temp}: {e_err}")

                # Pass 4: article → claim 的 contains 边
                for n in raw_nodes:
                    if n.get("node_type") != "claim":
                        continue
                    claim_temp = n.get("temp_id")
                    claim_uuid = temp_to_uuid.get(claim_temp)
                    if not claim_uuid:
                        continue
                    try:
                        await self.graph_store.create_edge(
                            source_id=article_id,
                            target_id=claim_uuid,
                            relation_type="contains",
                            confidence=1.0,
                            evidence_document_id=document_id,
                        )
                    except Exception as e:
                        logger.warning(f"article->claim contains edge failed: {e}")

        prop.status = "applied"
        flag_modified(prop, "status")
        await self.db.flush()

        return {
            "status": "applied",
            "article_node_id": str(article_id),
            "applied": applied,
            "failed": failed,
            "knowledge_nodes_created": knowledge_counts,
            "knowledge_edges_created": knowledge_edges_created,
        }
