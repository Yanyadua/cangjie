"""Phase 2 apply_proposal tests: claim/proposition 入库。"""
import pytest
from uuid import uuid4
from sqlalchemy import select
from app.models.db_models import Node, Edge, InsertionProposal, Document, DraftGraph
from app.services.clustering_service import ClusteringService


async def _make_doc(db_session, title="Test Doc"):
    """创建测试 Document。"""
    doc = Document(
        id=uuid4(), title=title, raw_content="content",
        cleaned_content="content", content_hash="hash_" + title, status="active",
    )
    db_session.add(doc)
    await db_session.flush()
    return doc.id


async def _make_proposal_with_draft(db_session, doc_id, draft_graph):
    """创建测试 InsertionProposal + DraftGraph（draft_graph 是 graph_json 内容）。"""
    # DraftGraph 必须创建，否则实现会找不到它
    from datetime import datetime
    dg = DraftGraph(
        id=uuid4(),
        document_id=doc_id,
        graph_json=draft_graph,
        status="draft",
    )
    db_session.add(dg)

    proposal_json = {
        "article_title": "Test Doc",
        "article_summary": "summary",
        "document_id": str(doc_id),
        "tag_actions": [],
        "topic_edges": [],
        "partition_action": {},
    }
    prop = InsertionProposal(
        id=uuid4(), document_id=doc_id,
        proposal_json=proposal_json, status="pending",
    )
    db_session.add(prop)
    await db_session.flush()
    return prop.id


async def test_apply_proposal_with_proposition_nodes(db_session):
    """proposition draft graph 入库后，claim + proposition 进 Node 表。"""
    doc_id = await _make_doc(db_session)
    draft_graph = {
        "summary": "test",
        "nodes": [
            {"temp_id": "c1", "node_type": "claim",
             "name": "claim 1", "description": "d1"},
            {"temp_id": "c2", "node_type": "claim",
             "name": "claim 2", "description": "d2"},
            {"temp_id": "p1", "node_type": "proposition",
             "name": "prop 1", "description": "self-contained fact one",
             "parent_claim_id": "c1"},
            {"temp_id": "p2", "node_type": "proposition",
             "name": "prop 2", "description": "self-contained fact two",
             "parent_claim_id": "c1"},
        ],
        "edges": [
            {"temp_id": "e1", "source": "p1", "target": "c1",
             "relation_type": "evidence_for", "confidence": 0.9, "evidence": "原文"},
        ],
    }
    prop_id = await _make_proposal_with_draft(db_session, doc_id, draft_graph)

    svc = ClusteringService(db_session)
    result = await svc.apply_proposal(prop_id)

    # 验证 claim + proposition 入库
    all_nodes = (await db_session.execute(
        select(Node).where(Node.source_document_id == doc_id)
    )).scalars().all()

    claims = [n for n in all_nodes if n.node_type == "claim"]
    propositions = [n for n in all_nodes if n.node_type == "proposition"]
    assert len(claims) == 2
    assert len(propositions) == 2

    # 验证 parent_node_id 指向对应 claim
    for prop in propositions:
        assert prop.parent_node_id is not None
        parent = next(c for c in claims if c.id == prop.parent_node_id)
        assert parent.node_type == "claim"

    # 验证返回统计
    assert result["knowledge_nodes_created"]["claim"] == 2
    assert result["knowledge_nodes_created"]["proposition"] == 2


async def test_apply_proposal_standard_mode_backward_compat(db_session):
    """standard draft graph（无 proposition）入库仍正常，claim 入库。"""
    doc_id = await _make_doc(db_session, "Standard Doc")
    draft_graph = {
        "summary": "std",
        "nodes": [
            {"temp_id": "c1", "node_type": "claim",
             "name": "claim 1", "description": "d1"},
        ],
        "edges": [],
    }
    prop_id = await _make_proposal_with_draft(db_session, doc_id, draft_graph)

    svc = ClusteringService(db_session)
    result = await svc.apply_proposal(prop_id)

    claims = (await db_session.execute(
        select(Node).where(
            Node.source_document_id == doc_id,
            Node.node_type == "claim",
        )
    )).scalars().all()
    assert len(claims) == 1
    assert result["knowledge_nodes_created"]["claim"] == 1


async def test_apply_proposal_nested_draft_format(db_session):
    """Regression: draft_graph 新版嵌套结构（{step, skeleton, expanded}）也能正确入库。"""
    doc_id = await _make_doc(db_session, "Nested Doc")
    # 新版结构：step1+step2 产出的格式
    draft_graph = {
        "step": 2,
        "skeleton": {
            "summary": "nested test",
            "topic_tags": [{"name": "t1"}],
            "core_claims": [],
        },
        "expanded": {
            "nodes": [
                {"temp_id": "c1", "node_type": "claim",
                 "name": "claim 1", "description": "d1"},
                {"temp_id": "p1", "node_type": "proposition",
                 "name": "prop 1", "description": "self-contained fact",
                 "parent_claim_id": "c1"},
            ],
            "edges": [
                {"temp_id": "e1", "source": "p1", "target": "c1",
                 "relation_type": "evidence_for", "confidence": 0.9, "evidence": "原文"},
            ],
        },
    }
    prop_id = await _make_proposal_with_draft(db_session, doc_id, draft_graph)

    svc = ClusteringService(db_session)
    result = await svc.apply_proposal(prop_id)

    # claim + proposition 都应该入库
    claims = (await db_session.execute(
        select(Node).where(
            Node.source_document_id == doc_id,
            Node.node_type == "claim",
        )
    )).scalars().all()
    propositions = (await db_session.execute(
        select(Node).where(
            Node.source_document_id == doc_id,
            Node.node_type == "proposition",
        )
    )).scalars().all()
    assert len(claims) == 1
    assert len(propositions) == 1
    # proposition 的 parent_node_id 指向 claim
    assert propositions[0].parent_node_id == claims[0].id
    # 返回统计正确
    assert result["knowledge_nodes_created"]["claim"] == 1
    assert result["knowledge_nodes_created"]["proposition"] == 1
    assert result["knowledge_edges_created"] == 1  # 1 knowledge edge (p1->c1)
