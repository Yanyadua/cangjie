# Black Hole Person Node Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the radial graph's center `person` node with a realistic black hole visual (3-layer CSS: halo + spinning accretion disk + event horizon), and fix the backend so `person` is always present and all partitions link back to it via `root` edges.

**Architecture:** Backend adds `GraphStore.attach_orphan_partitions(me_id)` and wires it into `/graph/global?filter_type=partition` alongside `ensure_me_node()`. Frontend replaces the 80×80 text-labelled PersonNode with a 120×120 three-div black hole animated by pure CSS (`conic-gradient` + `@keyframes spin`). No third-party animation libraries.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async / pytest (backend, SQLite in-memory). React 18 + TypeScript + @xyflow/react v12 + Tailwind v4 + shadcn/ui (frontend). Vite build is the frontend verification gate (no Jest).

**Design doc:** `docs/plans/2026-06-21-black-hole-person-node-design.md`

---

## Task 1: `GraphStore.attach_orphan_partitions()` (backend, TDD)

**Files:**
- Modify: `backend/app/core/graph_store.py:244` (insert after `ensure_me_node`)
- Test: `backend/tests/test_graph_store_phase2.py` (append new test)

### Step 1: Write the failing test

Append to `backend/tests/test_graph_store_phase2.py`:

```python
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
            Edge.target_id == orphan_id,
        )
    )
    assert result.scalar_one_or_none() is not None

    result2 = await db_session.execute(
        select(Edge).where(
            Edge.relation_type == "root",
            Edge.target_id == attached_id,
        )
    )
    assert len(result2.scalars().all()) == 1  # 没重复
```

### Step 2: Run test to verify it fails

Run from `backend/`:

```bash
cd backend && python -m pytest tests/test_graph_store_phase2.py::test_attach_orphan_partitions_links_rootless_partitions -v
```

Expected: FAIL with `AttributeError: 'GraphStore' object has no attribute 'attach_orphan_partitions'`.

### Step 3: Implement `attach_orphan_partitions`

Insert into `backend/app/core/graph_store.py` after the `ensure_me_node` method (after line 244, before `detect_duplicate_topics`):

```python
async def attach_orphan_partitions(self, me_id: UUID) -> int:
    """为所有无 root 入边的 partition 补建 person --root--> partition 边。

    返回新建的边数。用于一次性修复存量孤悬分区，使径向图谱层级完整。
    """
    # 找出所有 active partition
    result = await self.db.execute(
        select(Node).where(
            and_(Node.node_type == "partition", Node.status == "active")
        )
    )
    partitions = result.scalars().all()

    created = 0
    for p in partitions:
        # 检查是否已有 root 入边
        existing = await self.db.execute(
            select(Edge).where(
                and_(
                    Edge.target_id == p.id,
                    Edge.relation_type == "root",
                )
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            continue
        await self.create_edge(
            source_id=me_id,
            target_id=p.id,
            relation_type="root",
            confidence=1.0,
        )
        created += 1
    if created:
        await self.db.flush()
    return created
```

### Step 4: Run test to verify it passes

```bash
cd backend && python -m pytest tests/test_graph_store_phase2.py::test_attach_orphan_partitions_links_rootless_partitions -v
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/app/core/graph_store.py backend/tests/test_graph_store_phase2.py
git commit -m "feat(graph-store): attach_orphan_partitions back-fills rootless partitions"
```

---

## Task 2: Wire `/graph/global?filter_type=partition` to seed person + back-fill

**Files:**
- Modify: `backend/app/api/graph.py:55-60` (the `filter_type == "partition"` branch)

### Step 1: Modify the endpoint

In `backend/app/api/graph.py`, replace lines 55-60:

```python
    elif filter_type == "partition":
        # 分区视图：展示 我 + 分区 + topic + article 的层级结构
        nodes = [
            n for n in all_nodes
            if n["node_type"] in ("person", "partition", "topic", "article")
        ]
```

with:

```python
    elif filter_type == "partition":
        # 分区视图：展示 我 + 分区 + topic + article 的层级结构
        # 确保中心 person 节点存在，并为存量孤悬 partition 补建 root 边
        me_id = await store.ensure_me_node()
        await store.attach_orphan_partitions(me_id)
        await db.commit()
        all_nodes = await store.get_all_active_nodes()
        nodes = [
            n for n in all_nodes
            if n["node_type"] in ("person", "partition", "topic", "article")
        ]
```

**Note:** `get_all_active_nodes()` is re-fetched after `ensure_me_node`/`attach_orphan_partitions` so the freshly-created person (if any) is included in the response.

### Step 2: Verify backend boots and endpoint returns person

Start backend (if not running) and curl:

```bash
cd backend && python -c "import app.main" && echo "imports OK"
```

Expected: `imports OK` (no syntax errors).

If a running dev server is available (port 8000):

```bash
curl -s 'http://localhost:8000/api/graph/global?filter_type=partition' | python -c "import sys, json; d=json.load(sys.stdin); types=set(n['node_type'] for n in d['nodes']); print('types:', types); assert 'person' in types, 'person missing'; print('OK')"
```

Expected: `types: {..., 'person', ...}` then `OK`.

### Step 3: Commit

```bash
git add backend/app/api/graph.py
git commit -m "feat(graph-api): seed person + back-fill orphan partitions in /graph/global"
```

---

## Task 3: Fix MATCH `partition_action` to create `root` edge

**Files:**
- Modify: `backend/app/services/clustering_service.py:195-203`
- Test: `backend/tests/test_apply_proposal_phase2.py` (append new test)

### Step 1: Write the failing test

First check existing test patterns in `backend/tests/test_apply_proposal_phase2.py` to see what fixtures are used. Append a focused test that exercises the MATCH branch:

```python
async def test_apply_proposal_match_creates_root_edge(db_session):
    """MATCH partition_action 也应该建 person --root--> partition 边。"""
    from app.services.clustering_service import ClusteringService
    from app.core.graph_store import GraphStore
    from sqlalchemy import select
    from app.models.db_models import Edge

    store = GraphStore(db_session)
    # 预建目标 partition（模拟已存在的分区）
    target_id = await store.create_node(node_type="partition", name="已存在分区")

    service = ClusteringService(db_session)
    proposal = {
        "article_title": "test",
        "article_summary": "",
        "partition_action": {
            "action": "MATCH",
            "target_partition_id": str(target_id),
            "target_partition_name": "已存在分区",
            "score": 0.9,
            "reason": "",
        },
        "tag_actions": [],
        "topic_edges": [],
    }

    # 用最小依赖调用 apply_proposal（mock 掉 embedding/llm 如果需要）
    # 如果 apply_proposal 需要 article 落库，参考 test_apply_proposal_phase2.py 里的现有用例补齐 fixture
    # 这里假设可以直接调内部逻辑或 apply_proposal 已能处理空 tag_actions
    try:
        await service.apply_proposal(proposal)
    except Exception:
        pass  # 即使后续步骤失败，partition 处理应已完成

    # 验证 root 边存在
    result = await db_session.execute(
        select(Edge).where(
            Edge.relation_type == "root",
            Edge.target_id == target_id,
        )
    )
    assert result.scalar_one_or_none() is not None, "MATCH partition_action 未建 root 边"
```

**Note for implementer:** If `apply_proposal` has heavy dependencies (Document lookup, embedding), check how existing tests in `test_apply_proposal_phase2.py` handle this. The assertion is the key part — adjust the setup as needed to reach the MATCH branch.

### Step 2: Run test to verify it fails

```bash
cd backend && python -m pytest tests/test_apply_proposal_phase2.py::test_apply_proposal_match_creates_root_edge -v
```

Expected: FAIL with `AssertionError: MATCH partition_action 未建 root 边` (or setup-related error if fixture needs adjustment).

### Step 3: Implement the fix

In `backend/app/services/clustering_service.py`, replace lines 195-203:

```python
            elif partition_action.get("action") == "MATCH":
                target_id = partition_action.get("target_partition_id")
                if target_id:
                    try:
                        from uuid import UUID
                        partition_id = UUID(target_id)
                        applied.append(f"MATCH partition: {partition_action.get('target_partition_name', '')}")
                    except Exception as e:
                        failed.append(f"Partition match: {e}")
```

with:

```python
            elif partition_action.get("action") == "MATCH":
                target_id = partition_action.get("target_partition_id")
                if target_id:
                    try:
                        from uuid import UUID
                        partition_id = UUID(target_id)
                        # 确保 partition 挂到 person 中心（MATCH 模式以前漏建 root 边）
                        existing_root = await self.db.execute(
                            select(Edge).where(
                                and_(
                                    Edge.source_id == me_id,
                                    Edge.target_id == partition_id,
                                    Edge.relation_type == "root",
                                )
                            )
                        )
                        if not existing_root.scalar_one_or_none():
                            await self.graph_store.create_edge(
                                source_id=me_id,
                                target_id=partition_id,
                                relation_type="root",
                                confidence=1.0,
                            )
                        applied.append(f"MATCH partition: {partition_action.get('target_partition_name', '')}")
                    except Exception as e:
                        failed.append(f"Partition match: {e}")
```

Update the import at the top of `clustering_service.py` (line 9):

```python
from sqlalchemy import select
```

becomes:

```python
from sqlalchemy import select, and_
from ..models.db_models import InsertionProposal, Document, Edge
```

### Step 4: Run test to verify it passes

```bash
cd backend && python -m pytest tests/test_apply_proposal_phase2.py::test_apply_proposal_match_creates_root_edge -v
```

Expected: PASS.

### Step 5: Commit

```bash
git add backend/app/services/clustering_service.py backend/tests/test_apply_proposal_phase2.py
git commit -m "fix(clustering): MATCH partition_action now creates root edge to person"
```

---

## Task 4: Add black-hole CSS to `globals.css`

**Files:**
- Modify: `frontend/src/styles/globals.css` (append after line 198, end of file)

### Step 1: Append black-hole styles

Add at the end of `frontend/src/styles/globals.css`:

```css
/* ── Black hole person node (center of radial graph) ───────────── */
.black-hole {
  position: relative;
  width: 120px;
  height: 120px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.black-hole__halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(251, 191, 36, 0) 0%,
    rgba(251, 191, 36, 0.4) 40%,
    rgba(232, 148, 59, 0.5) 70%,
    rgba(76, 29, 149, 0.3) 100%
  );
  filter: blur(8px);
  pointer-events: none;
}

.black-hole__disk {
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(251, 191, 36, 0.8) 0deg,
    rgba(232, 148, 59, 0.6) 90deg,
    rgba(124, 58, 237, 0.5) 180deg,
    rgba(76, 29, 149, 0.4) 270deg,
    rgba(251, 191, 36, 0.8) 360deg
  );
  animation: black-hole-spin 30s linear infinite;
  pointer-events: none;
}

.black-hole__horizon {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #000;
  box-shadow:
    0 0 12px rgba(0, 0, 0, 0.9),
    inset 0 0 8px rgba(0, 0, 0, 1);
  z-index: 1;
}

@keyframes black-hole-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .black-hole__disk { animation: none; }
}
```

### Step 2: Verify CSS doesn't break build

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds (CSS errors won't fail Vite build, but syntax errors might).

### Step 3: Commit

```bash
git add frontend/src/styles/globals.css
git commit -m "style(graph): add black-hole CSS (halo + spinning disk + event horizon)"
```

---

## Task 5: Rewrite `PersonNode` component

**Files:**
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx:24-40` (replace `PersonNode` function)

### Step 1: Replace PersonNode implementation

In `frontend/src/components/RadialKnowledgeGraph.tsx`, replace the current `PersonNode` function (lines 24-40):

```tsx
function PersonNode({ data }: NodeProps<Node<RadialNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-4 text-base font-bold shadow-lg"
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        opacity: data.dimmed ? 0.2 : 1,
      }}
    >
      {data.label}
    </div>
  );
}
```

with:

```tsx
function PersonNode({ data }: NodeProps<Node<RadialNodeData>>) {
  return (
    <div
      onClick={data.onSelect}
      className="black-hole"
      style={{ opacity: data.dimmed ? 0.2 : 1 }}
      role="img"
      aria-label="我 — 知识图谱中心"
    >
      <div className="black-hole__halo" />
      <div className="black-hole__disk" />
      <div className="black-hole__horizon" />
    </div>
  );
}
```

**Note:** `nodeColorVar` import is no longer used by `PersonNode` — but it is still used by `PartitionNode`/`TopicNode`/`ArticleNode`, so leave the import in place.

### Step 2: Verify TypeScript compiles

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -10
```

Expected: no output (success).

### Step 3: Verify build

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ built in <N>s`.

### Step 4: Commit

```bash
git add frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): replace PersonNode with black hole visual"
```

---

## Task 6: Final verification + manual browser test

### Step 1: Run full backend test suite

```bash
cd backend && python -m pytest -v 2>&1 | tail -30
```

Expected: all tests pass (including new ones from Tasks 1 & 3).

### Step 2: Run frontend build

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ built`.

### Step 3: Manual browser checklist

Start both servers if not running, open `http://localhost:5173/graph`:

- [ ] Center shows a black hole (not empty, not a gold circle)
- [ ] Three visible layers: blurred gold/orange/purple halo, spinning gradient disk, black center
- [ ] Disk rotates slowly (30s per revolution)
- [ ] Halo glow extends beyond the disk
- [ ] Click partition → other partitions dim (black hole stays visible, only its halo dims if applicable)
- [ ] Click person (black hole) → resets all highlights and collapses topics
- [ ] Search box input → black hole dims if "我" or query doesn't match (it never matches because no text label, so it always dims on search — acceptable)
- [ ] No layout regression: partitions still radiate around center at R1=220
- [ ] Dark mode: black hole still visible (halo colors are RGBA, work on both themes)

### Step 4: Commit any adjustments (if needed)

Only commit if manual testing revealed issues requiring changes.

---

## Out of Scope (per design doc)

- Gravitational lensing effect (needs WebGL/Canvas)
- "Devour" animation when clicking partitions
- Cleaning up the `article --belongs_to--> partition` redundant edge (separate task, already in CLAUDE.md)
- Performance optimization (single black hole, negligible cost)

## Risks

1. **`apply_proposal` test setup complexity:** Task 3's test may need additional fixtures (Document row, etc.) to reach the MATCH branch. If so, mimic patterns from existing `test_apply_proposal_phase2.py` tests rather than inventing new fixtures.
2. **CSS `filter: blur` on React Flow node:** Single instance, negligible. If React Flow's viewport transform causes blur artifacts, reduce to `blur(4px)`.
3. **`attach_orphan_partitions` endpoint overhead:** Adds 1 SELECT + up to N INSERTs per `/graph/global?filter_type=partition` call. Partition count typically < 20; acceptable. If ever a bottleneck, memoize the "no orphans" short-circuit.
