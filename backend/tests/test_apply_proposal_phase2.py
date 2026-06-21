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


async def test_generate_proposal_nested_draft_format(db_session):
    """Regression: generate_proposal 能处理嵌套 draft_graph 结构（{step, skeleton, expanded}）。

    Phase 1 bug: generate_proposal 假设扁平结构，但 step1/step2 抽取后存的是嵌套结构，
    导致 topic_tags 永远读不到，返回 "No topic tags found" 错误。
    """
    from app.services.clustering_service import ClusteringService
    from app.models.db_models import Document

    # 建一个 Document
    doc = Document(
        id=uuid4(), title="Nested Bug Repro",
        raw_content="content", cleaned_content="content",
        content_hash="hash_nested", status="active",
    )
    db_session.add(doc)
    await db_session.flush()

    # 嵌套结构的 draft_graph（实际 step1+step2 后的格式）
    nested_graph = {
        "step": 2,
        "skeleton": {
            "summary": "Nested format test summary",
            "topic_tags": [
                {"name": "Topic A", "confidence": 0.9},
                {"name": "Topic B", "confidence": 0.8},
            ],
            "core_claims": [],
        },
        "expanded": {
            "nodes": [
                {"temp_id": "n1", "node_type": "topic", "name": "Topic A"},
                {"temp_id": "n2", "node_type": "topic", "name": "Topic B"},
            ],
            "edges": [],
        },
    }

    svc = ClusteringService(db_session)
    # We can't actually call planner without LLM, so test the tag extraction
    # directly by monkeypatching planner.generate_proposal to short-circuit
    async def fake_partition_match(*args, **kwargs):
        return {}
    async def fake_planner_generate(*args, **kwargs):
        return {
            "article_title": kwargs.get("article_title", ""),
            "article_summary": kwargs.get("article_summary", ""),
            "document_id": str(kwargs.get("document_id", "")),
            "tag_actions": [],
            "topic_edges": [],
        }
    svc.planner.match_partition = fake_partition_match
    svc.planner.generate_proposal = fake_planner_generate

    # NOTE: 传 doc.id（UUID 对象）而非 str；SQLite UUID shim 需要 UUID 实例。
    # 生产环境 generate_proposal 接受 str，asyncpg 会自动转换。
    result = await svc.generate_proposal(doc.id, nested_graph)

    # The bug: would return {"error": "No topic tags found..."}
    assert "error" not in result, f"Expected success, got error: {result}"
    assert "proposal_id" in result
    assert result["proposal_json"]["article_summary"] == "Nested format test summary"


async def test_generate_proposal_flat_draft_format_still_works(db_session):
    """Backward compat: 扁平 draft_graph 格式仍能正常工作。"""
    from app.services.clustering_service import ClusteringService
    from app.models.db_models import Document

    doc = Document(
        id=uuid4(), title="Flat Format",
        raw_content="content", cleaned_content="content",
        content_hash="hash_flat", status="active",
    )
    db_session.add(doc)
    await db_session.flush()

    flat_graph = {
        "summary": "Flat summary",
        "topic_tags": [{"name": "Flat Tag", "confidence": 0.9}],
        "nodes": [{"node_type": "topic", "name": "Flat Tag"}],
        "edges": [],
    }

    svc = ClusteringService(db_session)
    async def fake_partition_match(*args, **kwargs):
        return {}
    async def fake_planner_generate(*args, **kwargs):
        return {
            "article_title": kwargs.get("article_title", ""),
            "article_summary": kwargs.get("article_summary", ""),
            "document_id": str(kwargs.get("document_id", "")),
            "tag_actions": [],
            "topic_edges": [],
        }
    svc.planner.match_partition = fake_partition_match
    svc.planner.generate_proposal = fake_planner_generate

    result = await svc.generate_proposal(doc.id, flat_graph)
    assert "error" not in result
    assert result["proposal_json"]["article_summary"] == "Flat summary"


async def test_apply_proposal_match_creates_root_edge(db_session):
    """MATCH partition_action 也应该建 person --root--> partition 边。

    Bug 重现：MATCH 分支以前只记录 applied 不建 root 边，导致径向图谱中心断开。
    """
    from app.core.graph_store import GraphStore

    # 预建目标 partition（模拟已存在的分区）
    store = GraphStore(db_session)
    target_id = await store.create_node(node_type="partition", name="已存在分区")

    # 用标准 helper 建 doc + proposal，但把 partition_action 换成 MATCH
    doc_id = await _make_doc(db_session, title="Match Test")
    proposal_json = {
        "article_title": "Match Test",
        "article_summary": "summary",
        "document_id": str(doc_id),
        "tag_actions": [],
        "topic_edges": [],
        "partition_action": {
            "action": "MATCH",
            "target_partition_id": str(target_id),
            "target_partition_name": "已存在分区",
            "score": 0.9,
            "reason": "",
        },
    }
    # DraftGraph 仍要建（apply_proposal 会读它做 phase2 入库）
    from datetime import datetime
    dg = DraftGraph(
        id=uuid4(),
        document_id=doc_id,
        graph_json={"summary": "s", "nodes": [], "edges": []},
        status="draft",
    )
    db_session.add(dg)
    prop = InsertionProposal(
        id=uuid4(), document_id=doc_id,
        proposal_json=proposal_json, status="pending",
    )
    db_session.add(prop)
    await db_session.flush()
    prop_id = prop.id

    svc = ClusteringService(db_session)
    # apply_proposal 可能因 embedding/llm 不可用而部分失败，但 partition 处理在前面
    try:
        await svc.apply_proposal(prop_id)
    except Exception:
        pass

    # 验证 root 边存在
    result = await db_session.execute(
        select(Edge).where(
            Edge.relation_type == "root",
            Edge.target_node_id == target_id,
        )
    )
    assert result.scalar_one_or_none() is not None, "MATCH partition_action 未建 root 边"
