"""Phase 2 graph API tests: /graph/article/{id} 端点。"""
import pytest
from uuid import uuid4
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.graph_store import GraphStore
from app.database import get_db


async def test_get_article_subgraph_endpoint(db_session):
    """端点 /graph/article/{id} 返回子图。"""
    store = GraphStore(db_session)
    doc_id = uuid4()
    article_id = await store.create_node(
        node_type="article", name="art", source_document_id=doc_id
    )
    await store.create_node(
        node_type="claim", name="c1", source_document_id=doc_id
    )
    await db_session.commit()

    # 用 httpx AsyncClient + ASGITransport 打端点，覆盖 get_db dependency
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(f"/api/graph/article/{article_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["document_id"] == str(doc_id)
            assert len(data["nodes"]) == 1  # 1 claim
            assert data["nodes"][0]["node_type"] == "claim"
    finally:
        app.dependency_overrides.clear()


async def test_get_article_subgraph_endpoint_not_found(db_session):
    """不存在的 article_id 返回 404。"""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(f"/api/graph/article/{uuid4()}")
            assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_get_article_subgraph_endpoint_invalid_uuid(db_session):
    """非法 UUID 返回 400。"""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/graph/article/not-a-uuid")
            assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()
