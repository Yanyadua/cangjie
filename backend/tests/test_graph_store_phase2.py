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
