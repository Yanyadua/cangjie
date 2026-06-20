"""Smoke test: verify test infra works."""
from app.models.db_models import Node


async def test_db_session_fixture(db_session):
    """db_session fixture 能正常创建/查询 Node。"""
    node = Node(node_type="claim", name="test claim", description="d")
    db_session.add(node)
    await db_session.flush()

    from sqlalchemy import select
    result = await db_session.execute(select(Node))
    nodes = result.scalars().all()
    assert len(nodes) == 1
    assert nodes[0].name == "test claim"
