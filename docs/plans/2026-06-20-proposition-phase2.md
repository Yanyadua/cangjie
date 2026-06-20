# Proposition Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Phase 1 抽出的 claim + proposition 真正进入全局图，默认模式切换为 proposition，全局图支持按文章下钻。

**Architecture:** 数据模型加 `parent_node_id` 字段；`apply_proposal` 扩展入库 claim/proposition；新增 `/graph/article/{id}` 子图端点；前端默认改 proposition + 下钻面板。Feature flag 三层独立可控。

**Tech Stack:** FastAPI + SQLAlchemy async + PostgreSQL + pgvector（后端），React + TypeScript + @xyflow/react（前端），pytest + pytest-asyncio（测试）

**Design doc:** `docs/plans/2026-06-20-proposition-phase2-design.md`

**注意：** 项目当前无测试基础设施（requirements.txt 无 pytest，backend/tests/ 为空）。Task 1 搭建最小化 pytest 基础设施。后续关键任务（入库逻辑、查询逻辑）用 TDD，前端任务用 TypeScript check + 手动验证。

---

## Task 1: 搭建 pytest 测试基础设施

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_smoke.py`
- Create: `backend/pytest.ini`

**Step 1: 添加测试依赖**

在 `backend/requirements.txt` 末尾追加：
```
pytest>=8.0.0
pytest-asyncio>=0.23.0
```

**Step 2: 安装依赖**

Run: `cd backend && pip install -r requirements.txt`
Expected: 成功安装 pytest + pytest-asyncio

**Step 3: 创建 pytest 配置**

Create `backend/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
```

**Step 4: 创建 conftest.py（in-memory SQLite async fixture）**

Create `backend/tests/conftest.py`:
```python
"""Test fixtures for Phase 2.

使用 SQLite in-memory + aiosqlite 避免依赖真实 PostgreSQL。
"""
import asyncio
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.db_models import Base


@pytest_asyncio.fixture
async def db_session():
    """提供隔离的 async db session，测试后自动清理。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session

    await engine.dispose()
```

**Step 5: 安装 aiosqlite**

Run: `cd backend && pip install aiosqlite`
Then追加到 `requirements.txt`:
```
aiosqlite>=0.20.0
```

**Step 6: 写冒烟测试**

Create `backend/tests/test_smoke.py`:
```python
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
```

**Step 7: 运行测试**

Run: `cd backend && python -m pytest tests/test_smoke.py -v`
Expected: PASS (1 test)

**Step 8: Commit**

```bash
git add backend/requirements.txt backend/pytest.ini backend/tests/
git commit -m "test: 搭建 pytest + pytest-asyncio 测试基础设施"
```

---

## Task 2: Migration — Node.parent_node_id 字段

**Files:**
- Modify: `backend/app/models/db_models.py:47-59` (Node class)
- Create: `backend/scripts/migrate_phase2.py`

**Step 1: 修改 Node 模型**

在 `backend/app/models/db_models.py` 的 `Node` 类里，`source_document_id` 之后追加：

```python
    parent_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("nodes.id"),
        nullable=True,
        index=True,
    )
```

**Step 2: 创建 migration 脚本**

Create `backend/scripts/migrate_phase2.py`:
```python
"""Phase 2 migration: add parent_node_id to nodes.

Idempotent: 安全重复执行。使用部分索引只为 proposition 行建索引。
"""
import asyncio
from sqlalchemy import text
from app.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE nodes "
            "ADD COLUMN IF NOT EXISTS parent_node_id UUID REFERENCES nodes(id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_nodes_parent_node_id "
            "ON nodes(parent_node_id) WHERE parent_node_id IS NOT NULL"
        ))
        print("Phase 2 migration done: parent_node_id column + partial index added.")


if __name__ == "__main__":
    asyncio.run(migrate())
```

**Step 3: 验证脚本语法**

Run: `cd backend && python -c "import ast; ast.parse(open('scripts/migrate_phase2.py').read()); print('OK')"`
Expected: `OK`

**Step 4: 对真实数据库执行 migration**

Run: `cd backend && python scripts/migrate_phase2.py`
Expected: `Phase 2 migration done: parent_node_id column + partial index added.`

**Step 5: 验证字段存在**

Run: `psql $DATABASE_URL -c "\d nodes" | grep parent_node_id`
Expected: 显示 `parent_node_id | uuid`

**Step 6: 验证幂等（重复执行不报错）**

Run: `cd backend && python scripts/migrate_phase2.py`
Expected: 同样输出，不报错

**Step 7: 验证现有数据 parent_node_id 为 NULL**

Run: `psql $DATABASE_URL -c "SELECT count(*) FROM nodes WHERE parent_node_id IS NOT NULL"`
Expected: `0`

**Step 8: Commit**

```bash
git add backend/app/models/db_models.py backend/scripts/migrate_phase2.py
git commit -m "feat: Node 表加 parent_node_id 字段 + migration 脚本"
```

---

## Task 3: GraphStore.create_node 扩展 parent_node_id

**Files:**
- Modify: `backend/app/core/graph_store.py:85-103` (create_node method)
- Test: `backend/tests/test_graph_store_phase2.py`

**Step 1: 写失败测试**

Create `backend/tests/test_graph_store_phase2.py`:
```python
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
```

**Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_graph_store_phase2.py::test_create_node_with_parent -v`
Expected: FAIL with `TypeError: create_node() got an unexpected keyword argument 'parent_node_id'`

**Step 3: 修改 create_node**

在 `backend/app/core/graph_store.py` 的 `create_node` 方法签名加参数，方法体加字段：

```python
    async def create_node(
        self,
        node_type: str,
        name: str,
        description: Optional[str] = None,
        canonical_name: Optional[str] = None,
        source_document_id: Optional[UUID] = None,
        parent_node_id: Optional[UUID] = None,
    ) -> UUID:
        node = Node(
            id=uuid4(),
            node_type=node_type,
            name=name,
            canonical_name=canonical_name,
            description=description,
            source_document_id=source_document_id,
            parent_node_id=parent_node_id,
        )
        self.db.add(node)
        await self.db.flush()
        return node.id
```

同时修改 `_node_to_dict`（同文件底部）加字段：
```python
    def _node_to_dict(self, node: Node) -> dict:
        return {
            ...existing fields...
            "parent_node_id": str(node.parent_node_id) if node.parent_node_id else None,
            "status": node.status,
        }
```

**Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_graph_store_phase2.py -v`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add backend/app/core/graph_store.py backend/tests/test_graph_store_phase2.py
git commit -m "feat: GraphStore.create_node 支持 parent_node_id 参数"
```

---

## Task 4: GraphStore.get_article_subgraph 方法

**Files:**
- Modify: `backend/app/core/graph_store.py` (追加方法)
- Test: `backend/tests/test_graph_store_phase2.py` (追加测试)

**Step 1: 写失败测试**

追加到 `backend/tests/test_graph_store_phase2.py`:

```python
async def test_get_article_subgraph(db_session):
    """get_article_subgraph 返回 article 的 claim + proposition + 内部边。"""
    from uuid import uuid4
    store = GraphStore(db_session)
    doc_id = uuid4()

    # 建 article + 2 claim + 1 proposition（都共享 source_document_id）
    article_id = await store.create_node(
        node_type="article", name="art", source_document_id=doc_id
    )
    claim1 = await store.create_node(
        node_type="claim", name="c1", source_document_id=doc_id
    )
    claim2 = await store.create_node(
        node_type="claim", name="c2", source_document_id=doc_id
    )
    prop1 = await store.create_node(
        node_type="proposition", name="p1", description="self-contained fact",
        source_document_id=doc_id, parent_node_id=claim1,
    )
    # 边
    await store.create_edge(claim1, prop1, "evidence_for", confidence=0.9)
    await store.create_edge(claim1, claim2, "related_to", confidence=0.5)

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
    await store.create_node(
        node_type="claim", name="c1", source_document_id=doc_id
    )
    claim1_id = await store.get_all_active_nodes()
    # 简化：直接查
    from sqlalchemy import select
    from app.models.db_models import Node
    res = await db_session.execute(
        select(Node).where(Node.node_type == "claim")
    )
    claim_uuid = res.scalars().first().id

    await store.create_node(
        node_type="proposition", name="p1", description="self-contained fact",
        source_document_id=doc_id, parent_node_id=claim_uuid,
    )

    result = await store.get_article_subgraph(article_id, include_proposition=False)
    node_types = [n["node_type"] for n in result["nodes"]]
    assert "proposition" not in node_types
    assert node_types.count("claim") == 1


async def test_get_article_subgraph_not_found(db_session):
    """article 不存在时返回 None。"""
    store = GraphStore(db_session)
    result = await store.get_article_subgraph(uuid4())
    assert result is None
```

**Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_graph_store_phase2.py::test_get_article_subgraph -v`
Expected: FAIL with `AttributeError: 'GraphStore' object has no attribute 'get_article_subgraph'`

**Step 3: 实现 get_article_subgraph**

在 `backend/app/core/graph_store.py` 追加方法：

```python
    async def get_article_subgraph(
        self,
        article_id: UUID,
        include_proposition: bool = True,
    ) -> Optional[dict]:
        """获取 article 节点下属的 claim + proposition + 内部边。

        查询策略：通过 article.source_document_id 反查 document_id，
        再查所有共享该 source_document_id 的节点。
        """
        # Step 1: 拿 document_id
        art = await self.db.execute(
            select(Node.source_document_id).where(Node.id == article_id)
        )
        doc_id = art.scalar_one_or_none()
        if not doc_id:
            return None

        # Step 2: 查同 document 的知识节点（排除 article 自己）
        node_query = select(Node).where(
            and_(
                Node.source_document_id == doc_id,
                Node.id != article_id,
                Node.status == "active",
            )
        )
        if not include_proposition:
            node_query = node_query.where(Node.node_type != "proposition")

        nodes = (await self.db.execute(node_query)).scalars().all()
        node_ids = [n.id for n in nodes]

        # Step 3: 内部边
        edges = await self.get_edges_for_nodes(node_ids) if node_ids else []

        return {
            "article_id": str(article_id),
            "document_id": str(doc_id),
            "nodes": [self._node_to_dict(n) for n in nodes],
            "edges": edges,
        }
```

**Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_graph_store_phase2.py -v`
Expected: PASS (5 tests: 2 from Task 3 + 3 new)

**Step 5: Commit**

```bash
git add backend/app/core/graph_store.py backend/tests/test_graph_store_phase2.py
git commit -m "feat: GraphStore.get_article_subgraph 查询文章子图"
```

---

## Task 5: apply_proposal 扩展 — claim/proposition 节点入库

**这是 Phase 2 最核心的任务。**

**Files:**
- Modify: `backend/app/services/clustering_service.py:121-285` (apply_proposal)
- Test: `backend/tests/test_apply_proposal_phase2.py`

**Step 1: 写失败测试**

Create `backend/tests/test_apply_proposal_phase2.py`:
```python
"""Phase 2 apply_proposal tests: claim/proposition 入库。"""
import pytest
from uuid import uuid4
from sqlalchemy import select
from app.models.db_models import Node, Edge, InsertionProposal, Document
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


async def _make_proposal(db_session, doc_id, draft_graph):
    """创建测试 InsertionProposal。"""
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
    return prop.id, draft_graph


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
    prop_id, _ = await _make_proposal(db_session, doc_id, draft_graph)

    svc = ClusteringService(db_session)
    # monkeypatch: 绕过 LLM/embedding，直接用 draft_graph
    svc.graph_store.__class__  # ensure accessible

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
```

**Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_apply_proposal_phase2.py::test_apply_proposal_with_proposition_nodes -v`
Expected: FAIL — apply_proposal 当前不处理 draft_graph nodes，claims 数为 0

**Step 3: 实现 — 在 apply_proposal 的 topic edge 循环之后追加知识节点入库逻辑**

在 `backend/app/services/clustering_service.py` 的 `apply_proposal` 方法里，在 `for edge in topic_edges:` 循环结束之后、`prop.status = "applied"` 之前，追加：

```python
        # ── Phase 2: 知识节点入库（claim / proposition / concept 等）──
        import os
        knowledge_ingest = os.getenv("PHASE2_KNOWLEDGE_INGEST", "true") == "true"

        knowledge_counts: dict[str, int] = {}
        knowledge_edges_created = 0

        if knowledge_ingest:
            # 拿 draft_graph（从 proposal 关联的 document 的最新 DraftGraph）
            from ..models.db_models import DraftGraph
            dg_result = await self.db.execute(
                select(DraftGraph).where(
                    DraftGraph.document_id == document_id
                ).order_by(DraftGraph.updated_at.desc()).limit(1)
            )
            draft = dg_result.scalar_one_or_none()
            if draft:
                draft_graph = draft.graph_json
                temp_to_uuid: dict[str, UUID] = {}

                # 先入库非 proposition 节点（claim/concept/method/...）
                # 再入库 proposition（依赖 parent claim 已入库）
                raw_nodes = draft_graph.get("nodes", [])
                skip_types = {"topic", "article"}  # 这两类已在上游处理

                non_prop_nodes = [
                    n for n in raw_nodes
                    if n.get("node_type") == "proposition"
                    or n.get("node_type") not in skip_types
                ]

                # Pass 1: 非 proposition 节点
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
                        # claim 生成 embedding（保持现有行为）
                        if ntype == "claim":
                            try:
                                emb = await self.embedding.embed(
                                    str(n.get("description", n.get("name", "")))
                                )
                                await self.vector_store.upsert_node_embedding(node_uuid, emb)
                            except Exception as e:
                                logger.warning(f"Claim embedding failed: {e}")
                    except Exception as e:
                        failed.append(f"Node '{temp_id}': {e}")

                # Pass 2: proposition 节点（parent_claim_id 已在 temp_to_uuid）
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

                # Pass 3: 知识边（draft_graph.edges 里非系统边）
                system_edge_patterns = {
                    # 跳过已被上游处理的边
                }
                for e in draft_graph.get("edges", []):
                    src_temp = e.get("source")
                    tgt_temp = e.get("target")
                    src_uuid = temp_to_uuid.get(src_temp)
                    tgt_uuid = temp_to_uuid.get(tgt_temp)
                    # 两端都必须是知识节点（topic/article 的边上游已处理）
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
```

然后在 return 语句扩展：
```python
        return {
            "status": "applied",
            "article_node_id": str(article_id),
            "applied": applied,
            "failed": failed,
            "knowledge_nodes_created": knowledge_counts,
            "knowledge_edges_created": knowledge_edges_created,
        }
```

**注意**：原 return 语句（`prop.status = "applied"` 之后）可能缺少部分字段。把 `knowledge_ingest=False` 分支也加上空统计：

```python
        # knowledge_ingest=False 时的兜底（在 if knowledge_ingest 块的 else 分支或 return 前）
        if not knowledge_ingest:
            knowledge_counts = {}
            knowledge_edges_created = 0
```

**Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_apply_proposal_phase2.py::test_apply_proposal_with_proposition_nodes -v`
Expected: PASS

如果失败，常见原因：
- `document_id` 类型问题（UUID vs str）：在 apply_proposal 开头加 `document_id = UUID(document_id) if isinstance(document_id, str) else document_id`
- DraftGraph 查询不到：检查测试是否正确创建了 DraftGraph

**Step 5: 补充向后兼容测试**

追加到 `test_apply_proposal_phase2.py`:
```python
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
    prop_id, _ = await _make_proposal(db_session, doc_id, draft_graph)

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
```

**Step 6: 运行所有 Phase 2 测试**

Run: `cd backend && python -m pytest tests/test_apply_proposal_phase2.py tests/test_graph_store_phase2.py -v`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_apply_proposal_phase2.py
git commit -m "feat: apply_proposal 入库 claim + proposition 节点（含 parent_node_id）"
```

---

## Task 6: 后端默认 ExtractionMode 改 PROPOSITION + Feature flag

**Files:**
- Modify: `backend/app/models/schemas.py:9-12` (ExtractionMode enum)
- Modify: `backend/app/api/extraction.py:23-46` (run_step2 + stream_step2 defaults)

**Step 1: 修改 ExtractionMode 默认**

`backend/app/models/schemas.py` 改为（注释更新，不改枚举值）：

```python
class ExtractionMode(str, Enum):
    """抽取模式。Phase 2 起 proposition 为推荐默认。"""
    STANDARD = "standard"
    PROPOSITION = "proposition"
```

**Step 2: 修改 API 端点默认**

`backend/app/api/extraction.py` 的 `run_step2` 和 `stream_step2` 签名，默认值改为：

```python
import os

def _default_extraction_mode() -> ExtractionMode:
    """从环境变量读默认抽取模式。"""
    if os.getenv("PHASE2_DEFAULT_PROPOSITION", "true") == "false":
        return ExtractionMode.STANDARD
    return ExtractionMode.PROPOSITION


@router.post("/extraction/{document_id}/step2")
async def run_step2(
    document_id: str,
    mode: ExtractionMode = None,  # 见下
    db: AsyncSession = Depends(get_db),
):
    if mode is None:
        mode = _default_extraction_mode()
    ...

@router.get("/extraction/{document_id}/step2/stream")
async def stream_step2(
    document_id: str,
    mode: ExtractionMode = None,
    db: AsyncSession = Depends(get_db),
):
    if mode is None:
        mode = _default_extraction_mode()
    ...
```

**注意**：FastAPI 的 `None` 默认值 + 运行时填充的写法，需要把参数标记为 Optional。如果 FastAPI 不接受这种写法，改为直接用 `_default_extraction_mode()` 作为默认值（但 Python 默认参数在函数定义时求值，env 读取没问题）：

```python
@router.post("/extraction/{document_id}/step2")
async def run_step2(
    document_id: str,
    mode: ExtractionMode = ExtractionMode.PROPOSITION,
    db: AsyncSession = Depends(get_db),
):
    ...
```

这个更简单。Feature flag 通过 `.env` 控制时，需要在 app 启动时读一次，或接受默认就是 PROPOSITION（feature flag 只用于紧急回退时改代码）。**推荐用简单版（默认 PROPOSITION）**，feature flag 文档化为"回退时改一行代码"。

**Step 3: 用简单版（默认 PROPOSITION）**

修改 `run_step2` 和 `stream_step2`：
```python
    mode: ExtractionMode = ExtractionMode.PROPOSITION,
```

**Step 4: 验证后端语法**

Run: `cd backend && python -c "import ast; ast.parse(open('app/api/extraction.py').read()); ast.parse(open('app/models/schemas.py').read()); print('OK')"`
Expected: `OK`

**Step 5: 重启后端验证**

Run: `pkill -f "uvicorn app.main" && sleep 1 && cd backend && nohup uvicorn app.main:app --port 8000 > /tmp/uvicorn.log 2>&1 &`
Then: `sleep 3 && curl -sS http://localhost:8000/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); print(d['paths']['/api/extraction/{document_id}/step2']['post']['parameters'])"`

Expected: 显示 `mode` 参数 default 为 `"proposition"`

**Step 6: Commit**

```bash
git add backend/app/api/extraction.py backend/app/models/schemas.py
git commit -m "feat: 后端默认 ExtractionMode 改为 PROPOSITION"
```

---

## Task 7: 新增 /graph/article/{id} 端点

**Files:**
- Modify: `backend/app/api/graph.py` (追加路由)
- Test: `backend/tests/test_graph_api_phase2.py`

**Step 1: 写失败测试（端点级）**

Create `backend/tests/test_graph_api_phase2.py`:
```python
"""Phase 2 graph API tests."""
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.core.graph_store import GraphStore


async def test_get_article_subgraph_endpoint(db_session, monkeypatch):
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

    # 用 TestClient 直接打端点（覆盖 get_db dependency）
    async def override_get_db():
        yield db_session

    app.dependency_overrides[__import__("app.database", fromlist=["get_db"]).get_db] = override_get_db
    client = TestClient(app)

    response = client.get(f"/api/graph/article/{article_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["document_id"] == str(doc_id)
    assert len(data["nodes"]) == 1  # 1 claim

    app.dependency_overrides.clear()
```

**Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_graph_api_phase2.py -v`
Expected: FAIL — 404（端点不存在）

**Step 3: 添加端点**

在 `backend/app/api/graph.py` 追加：

```python
from uuid import UUID

@router.get("/graph/article/{article_id}")
async def get_article_subgraph(
    article_id: str,
    include_proposition: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """返回某篇文章的 claim + proposition 子图（含内部边）。

    用于全局宏观图点 article 节点后的下钻视图。
    """
    store = GraphStore(db)
    try:
        aid = UUID(article_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid article_id")
    result = await store.get_article_subgraph(aid, include_proposition=include_proposition)
    if not result:
        raise HTTPException(status_code=404, detail="Article not found")
    return result
```

**Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_graph_api_phase2.py -v`
Expected: PASS

**Step 5: 重启后端手动验证**

Run: `pkill -f "uvicorn app.main" && sleep 1 && cd backend && nohup uvicorn app.main:app --port 8000 > /tmp/uvicorn.log 2>&1 &`

找一个已有 article 节点 id（从数据库），测试：
```bash
psql $DATABASE_URL -c "SELECT id, name FROM nodes WHERE node_type='article' LIMIT 1"
# 用返回的 id 测试
curl -sS "http://localhost:8000/api/graph/article/<article_id>" | python -m json.tool | head -20
```

Expected: 返回 JSON，含 nodes 和 edges

**Step 6: Commit**

```bash
git add backend/app/api/graph.py backend/tests/test_graph_api_phase2.py
git commit -m "feat: 新增 /graph/article/{id} 端点返回文章子图"
```

---

## Task 8: 前端 client.ts — getArticleSubgraph + streamStep2 默认

**Files:**
- Modify: `frontend/src/api/client.ts:138-157` (streamStep2) + 追加 getArticleSubgraph

**Step 1: 修改 streamStep2 默认 mode**

`frontend/src/api/client.ts:141` 改：
```typescript
  mode: 'standard' | 'proposition' = 'proposition',
```

**Step 2: 追加 getArticleSubgraph 函数**

在 `client.ts` 末尾追加：
```typescript
// ── Phase 2: 文章子图下钻 ──

export async function getArticleSubgraph(
  articleId: string,
  includeProposition = true,
): Promise<{
  article_id: string;
  document_id: string;
  nodes: Array<{
    id: string;
    node_type: string;
    name: string;
    description: string | null;
    parent_node_id: string | null;
    source_document_id: string | null;
    status: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation_type: string;
    confidence: number;
    evidence_text: string | null;
    status: string;
  }>;
}> {
  const url = `/api/graph/article/${articleId}?include_proposition=${includeProposition}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

**Step 3: TypeScript 检查**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: 前端 getArticleSubgraph + streamStep2 默认改 proposition"
```

---

## Task 9: 前端 ExtractionWizardPage — 默认 + UI 文案

**Files:**
- Modify: `frontend/src/pages/ExtractionWizardPage.tsx:41` (state default)
- Modify: `frontend/src/pages/ExtractionWizardPage.tsx:264-277` (UI 文案 + radio 顺序)

**Step 1: 修改 state 默认值**

`ExtractionWizardPage.tsx:41`:
```typescript
const [extractionMode, setExtractionMode] = useState<'standard' | 'proposition'>('proposition');
```

**Step 2: 重写 UI 区块**

替换 `ExtractionWizardPage.tsx` 第 264-277 行（"抽取模式（实验性）"整个 div）：

```tsx
<div style={{ marginBottom: 12, padding: 12, background: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a' }}>
  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, color: '#92400e' }}>抽取模式</div>
  <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
      <input type="radio" checked={extractionMode === 'proposition'} onChange={() => setExtractionMode('proposition')} />
      命题化（推荐 · 每个 claim 展开 2-5 个自包含命题，还原度更高）
    </label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
      <input type="radio" checked={extractionMode === 'standard'} onChange={() => setExtractionMode('standard')} />
      标准（topic + claim + 实体，适合抽象理论文）
    </label>
  </div>
  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
    💡 命题化在新闻/综述/工程类文章上 F1 提升 20-50%；
    高度抽象的理论文（纯数学/纯概念关系）建议用标准模式。
  </div>
</div>
```

**Step 3: TypeScript 检查**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 4: 手动验证（启动前端 dev server）**

Run: `cd frontend && npm run dev > /tmp/vite.log 2>&1 &`

打开 `http://localhost:5173/extract/<某 document_id>`，确认：
- 默认选中"命题化"
- 文案显示路由提示
- radio 顺序：命题化在前

**Step 5: Commit**

```bash
git add frontend/src/pages/ExtractionWizardPage.tsx
git commit -m "feat: 抽取向导默认改 proposition + UI 路由提示"
```

---

## Task 10: 前端 GlobalGraphPage — 下钻面板

**Files:**
- Modify: `frontend/src/pages/GlobalGraphPage.tsx`

**Step 1: 读当前 GlobalGraphPage 结构**

Run: Read `frontend/src/pages/GlobalGraphPage.tsx` 全文，理解：
- 主图区在哪里渲染（GraphEditor 调用位置）
- 节点点击事件处理
- 现有布局（左侧 panel）

**Step 2: 添加 import 和 state**

在 GlobalGraphPage.tsx 顶部追加 import：
```typescript
import { getArticleSubgraph } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';
```

在组件函数体顶部（其他 useState 旁）追加：
```typescript
const [drillingArticleId, setDrillingArticleId] = useState<string | null>(null);
const [drillingArticleName, setDrillingArticleName] = useState('');
const [subGraph, setSubGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
const [subGraphLoading, setSubGraphLoading] = useState(false);
```

**Step 3: 添加点击处理函数**

```typescript
const handleArticleDrillDown = async (nodeId: string, nodeName: string) => {
  setDrillingArticleId(nodeId);
  setDrillingArticleName(nodeName);
  setSubGraphLoading(true);
  setSubGraph(null);
  try {
    const data = await getArticleSubgraph(nodeId);
    const nodes: GraphNode[] = data.nodes.map((n: any) => ({
      id: n.id,
      nodeType: n.node_type,
      name: n.name,
      description: n.description,
    }));
    const edges: GraphEdge[] = data.edges.map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relationType: e.relation_type,
      confidence: e.confidence,
    }));
    setSubGraph({ nodes, edges });
  } catch (e: any) {
    console.error('Drill down failed:', e);
  } finally {
    setSubGraphLoading(false);
  }
};
```

**Step 4: 在 GraphEditor 的 onNodeClick 或节点交互回调里挂载**

找到现有 GraphEditor 调用，给它的节点点击回调加：
```typescript
onNodeClick={(node) => {
  if (node.data?.nodeType === 'article') {
    handleArticleDrillDown(node.id, node.data?.name || node.id);
  }
}}
```

（具体属性名看现有 GraphEditor 接口）

**Step 5: 渲染下钻面板**

在主容器 JSX 末尾（闭合 `</div>` 前）追加：
```tsx
{drillingArticleId && (
  <div style={{
    position: 'absolute',
    right: 16, top: 16, bottom: 16,
    width: 480,
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
  }}>
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontWeight: 600,
      fontSize: 13,
    }}>
      <span>文章下钻：{drillingArticleName}</span>
      <button
        onClick={() => { setDrillingArticleId(null); setSubGraph(null); }}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 16, color: '#64748b',
        }}
      >✕</button>
    </div>
    <div style={{ flex: 1, position: 'relative' }}>
      {subGraphLoading && (
        <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>加载中...</div>
      )}
      {!subGraphLoading && subGraph && (
        <GraphEditor graphData={subGraph} editable={false} />
      )}
      {!subGraphLoading && !subGraph && (
        <div style={{ padding: 20, color: '#94a3b8', fontSize: 13 }}>
          该文章暂无知识节点
        </div>
      )}
    </div>
  </div>
)}
```

**注意**：主容器 `div` 需要加 `position: 'relative'` 才能让浮层 absolute 定位生效。检查 GlobalGraphPage 根 div 是否已有。

**Step 6: TypeScript 检查**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 7: 手动验证**

打开 `http://localhost:5173/graph`：
- 点击 article 节点 → 右侧弹出下钻面板
- 面板内显示 claim + proposition 子图
- 点 ✕ 关闭面板
- 点击非 article 节点（topic）→ 不弹面板

**Step 8: Commit**

```bash
git add frontend/src/pages/GlobalGraphPage.tsx
git commit -m "feat: 全局图新增文章下钻面板（点击 article 显示 claim+proposition 子图）"
```

---

## Task 11: 前端 ClusteringProposalPage — 入库统计显示

**Files:**
- Modify: `frontend/src/pages/ClusteringProposalPage.tsx`

**Step 1: 找到 apply 成功提示位置**

Read `frontend/src/pages/ClusteringProposalPage.tsx`，定位 `apply_proposal` 调用成功后的 UI 提示（通常是 `alert` 或 inline message）。

**Step 2: 显示知识节点统计**

在 apply 成功的回调里，扩展提示信息。例如原代码是：
```typescript
const result = await applyProposal(proposalId);
alert('应用成功');
```

改为：
```typescript
const result = await applyProposal(proposalId);
const counts = result.knowledge_nodes_created || {};
const summary = Object.entries(counts)
  .map(([type, n]) => `${type}: ${n}`)
  .join('，');
alert(
  `应用成功\n\n入库统计：\n${summary || '无知识节点'}\n知识边：${result.knowledge_edges_created || 0}`
);
```

**Step 3: TypeScript 检查**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add frontend/src/pages/ClusteringProposalPage.tsx
git commit -m "feat: 入库成功提示显示 claim/proposition 统计"
```

---

## Task 12: 端到端冒烟测试

**Files:** 无代码改动，纯手动验证

**Step 1: 重启后端（加载所有 Phase 2 改动）**

```bash
pkill -f "uvicorn app.main"
sleep 1
cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend
nohup uvicorn app.main:app --port 8000 > /tmp/uvicorn_phase2.log 2>&1 &
sleep 3
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/api/health
```
Expected: `HTTP 200`

**Step 2: 导入一篇新文章**

在 `http://localhost:5173/import` 导入一篇新文章（选一篇中等长度新闻/综述类）。

**Step 3: 验证默认走 proposition 模式**

进入 `/extract/<new_doc_id>`，确认：
- 默认选中"命题化"
- 点击"确认骨架并展开图谱"
- 流式生成过程中，观察生成的节点是否含 proposition 类型

**Step 4: 走完抽取流程到 draft graph**

确认 DraftGraph 里能看到 claim（蓝）+ proposition（浅紫）节点。

**Step 5: 确认入库**

进入聚类提案页面，点"应用"：
- 确认提示显示 `claim: N，proposition: M，知识边: K`
- N、M > 0

**Step 6: 验证全局图下钻**

进入 `/graph`：
- 全局宏观图节点数不爆炸（只有 topic + article）
- 点击新入库的 article 节点
- 右侧弹出下钻面板，显示 claim + proposition 子图

**Step 7: 验证数据库**

```bash
psql $DATABASE_URL -c "
SELECT node_type, count(*)
FROM nodes
WHERE source_document_id = '<new_doc_id>'
GROUP BY node_type
"
```
Expected: 显示 claim、proposition、article 各类型计数

```bash
psql $DATABASE_URL -c "
SELECT count(*) FROM nodes
WHERE parent_node_id IS NOT NULL
"
```
Expected: > 0（proposition 节点都有 parent）

**Step 8: 如果任何一步失败，记录问题并修复**

不要跳过失败步骤。每个问题都要定位根因。

---

## Task 13: 回归测试 + TypeScript 最终检查

**Step 1: 跑所有后端测试**

Run: `cd backend && python -m pytest tests/ -v`
Expected: 所有测试 PASS

**Step 2: TypeScript 最终检查**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 3: 验证 standard 模式仍可用**

导入另一篇文章，在抽取页面手动选"标准"模式：
- 走完抽取（生成 topic + claim，无 proposition）
- 确认入库正常（claim 也入库了——bonus fix）

**Step 4: 验证评估实验室仍正常**

进入 `/eval`，选一篇文章，勾选"标准 + 命题化"：
- 确认 4 策略对比仍正常工作
- 确认评分表、差异详情、图谱预览都显示

**Step 5: 验证已有 draft graph 不受影响**

找一个 Phase 1 抽过的 proposition draft graph，确认：
- 仍能编辑
- 入库正常（Phase 2 后入库会带上 claim/proposition）

**Step 6: 如果全部通过，最终 commit（如有遗漏改动）**

```bash
git status
# 如有未提交改动
git add -A && git commit -m "test: Phase 2 回归测试通过"
```

---

## 风险检查清单（每个任务执行后自检）

- [ ] Task 2 migration 后，现有节点 parent_node_id 全为 NULL（向后兼容）
- [ ] Task 5 apply_proposal 改动后，standard 模式 draft graph 仍能入库（测试覆盖）
- [ ] Task 6 默认改 proposition 后，旧前端缓存不会卡住（后端双重兜底）
- [ ] Task 10 下钻面板不影响现有 GlobalGraphPage 左侧 panel 布局
- [ ] 所有 feature flag 默认 true（紧急回退改一行代码或一个环境变量）

## 完成 Definition of Done

- [ ] 13 个 task 全部完成，commit 历史清晰
- [ ] 后端测试全 PASS
- [ ] TypeScript 0 errors
- [ ] 端到端冒烟测试：导入 → 默认 proposition 抽取 → 入库（claim + proposition） → 全局图下钻 全链路通
- [ ] 回归：standard 模式 + 评估实验室 + 已有数据 不受影响
- [ ] 数据库验证：proposition 节点 parent_node_id 正确指向 claim
