"""Phase 2 GraphStore tests."""
import pytest
from uuid import uuid4
from app.core.graph_store import GraphStore


async def test_create_node_with_parent(db_session):
    """create_node 支持 parent_node_id，正确落库。"""
    store = GraphStore(db_session)

    # 先创建 parent claim
    claim_id = await store.create_node(
        node_type="claim", name="parent claim", description="d"
    )

    # 创建 child proposition 带 parent_node_id
    prop_id = await store.create_node(
        node_type="proposition",
        name="child prop",
        description="self-contained fact statement with enough chars",
        parent_node_id=claim_id,
    )

    # 验证
    prop = await store.get_node(prop_id)
    assert prop is not None
    assert prop["parent_node_id"] == str(claim_id)


async def test_create_node_without_parent_backward_compat(db_session):
    """现有调用（不传 parent_node_id）行为不变。"""
    store = GraphStore(db_session)
    topic_id = await store.create_node(node_type="topic", name="topic")
    topic = await store.get_node(topic_id)
    assert topic["parent_node_id"] is None


async def test_get_article_subgraph(db_session):
    """get_article_subgraph 返回 article 的 claim + proposition + 内部边。"""
    from uuid import uuid4
    store = GraphStore(db_session)
    doc_id = uuid4()

    # 建 article + 2 claim + 1 proposition（都共享 source_document_id）
    article_id = await store.create_node(
        node_type="article", name="art", source_document_id=doc_id
    )
    claim1_id = await store.create_node(
        node_type="claim", name="c1", source_document_id=doc_id
    )
    claim2_id = await store.create_node(
        node_type="claim", name="c2", source_document_id=doc_id
    )
    prop1_id = await store.create_node(
        node_type="proposition", name="p1", description="self-contained fact",
        source_document_id=doc_id, parent_node_id=claim1_id,
    )
    # 边
    await store.create_edge(claim1_id, prop1_id, "evidence_for", confidence=0.9)
    await store.create_edge(claim1_id, claim2_id, "related_to", confidence=0.5)

    # 查询
    result = await store.get_article_subgraph(article_id)
    assert result is not None
    assert result["document_id"] == str(doc_id)
    # nodes 应该有 3 个（2 claim + 1 prop），排除 article 自己
    assert len(result["nodes"]) == 3
    node_types = [n["node_type"] for n in result["nodes"]]
    assert node_types.count("claim") == 2
    assert node_types.count("proposition") == 1
    # edges 应该有 2 条
    assert len(result["edges"]) == 2


async def test_get_article_subgraph_exclude_proposition(db_session):
    """include_proposition=False 时不返回 proposition。"""
    from uuid import uuid4
    store = GraphStore(db_session)
    doc_id = uuid4()
    article_id = await store.create_node(
        node_type="article", name="art", source_document_id=doc_id
    )
    claim1_id = await store.create_node(
        node_type="claim", name="c1", source_document_id=doc_id
    )
    await store.create_node(
        node_type="proposition", name="p1", description="self-contained fact",
        source_document_id=doc_id, parent_node_id=claim1_id,
    )

    result = await store.get_article_subgraph(article_id, include_proposition=False)
    node_types = [n["node_type"] for n in result["nodes"]]
    assert "proposition" not in node_types
    assert node_types.count("claim") == 1


async def test_get_article_subgraph_not_found(db_session):
    """article 不存在时返回 None。"""
    from uuid import uuid4
    store = GraphStore(db_session)
    result = await store.get_article_subgraph(uuid4())
    assert result is None


async def test_attach_orphan_partitions_links_rootless_partitions(db_session):
    """attach_orphan_partitions 为所有无 root 入边的 partition 建 root 边。"""
    store = GraphStore(db_session)

    me_id = await store.ensure_me_node()
    # 建 2 个 partition，其中只一个预先挂 root
    attached_id = await store.create_node(node_type="partition", name="挂上的")
    orphan_id = await store.create_node(node_type="partition", name="孤悬的")
    await store.create_edge(
        source_id=me_id, target_id=attached_id,
        relation_type="root", confidence=1.0,
    )

    # 执行修复
    await store.attach_orphan_partitions(me_id)

    # 验证：orphan 现在有 root 入边，attached 不重复建
    from sqlalchemy import select
    from app.models.db_models import Edge
    result = await db_session.execute(
        select(Edge).where(
            Edge.relation_type == "root",
            Edge.target_node_id == orphan_id,
        )
    )
    assert result.scalar_one_or_none() is not None

    result2 = await db_session.execute(
        select(Edge).where(
            Edge.relation_type == "root",
            Edge.target_node_id == attached_id,
        )
    )
    assert len(result2.scalars().all()) == 1  # 没重复
