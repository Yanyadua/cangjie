# 以"我"为核心的个人分区化全局图谱 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 全局图谱以"我"节点为中心，用户可创建主题分区，导入文章自动匹配并挂载到分区，呈现 `我 → 分区 → topic → article` 层次结构。

**Architecture:** 复用现有 Node 表，新增 `partition`/`person` 节点类型和 `root`/`belongs_to` 关系类型。分区匹配在聚类提案阶段完成，复用现有提案 UI。分区匹配用摘要+标签加权向量检索，未匹配时 LLM 建议新分区。

**Tech Stack:** FastAPI + SQLAlchemy + pgvector（后端），React + TypeScript + @xyflow/react（前端）

**Design doc:** `docs/plans/2026-06-14-personal-centric-partition-design.md`

**验证策略:** 项目无测试框架，每个任务用 Python 语法检查 / `tsc --noEmit` 类型检查验证，关键任务手动 curl 或浏览器测试。

---

### Task 1: 类型白名单扩展

**Files:**
- Modify: `backend/app/core/graph_extractor.py` (VALID_NODE_TYPES, VALID_RELATION_TYPES)
- Modify: `backend/app/models/schemas.py` (NODE_TYPES, RELATION_TYPES)
- Modify: `frontend/src/types/graph.ts` (NodeType, RelationType, NODE_COLORS, NODE_TYPES, RELATION_TYPES)

**Step 1: 后端白名单扩展**

`graph_extractor.py` 修改两个 frozenset：

```python
VALID_NODE_TYPES = frozenset({
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology", "question",
    "partition",  # 新增
    "person",     # 新增
})

VALID_RELATION_TYPES = frozenset({
    "related_to", "contains", "part_of", "supports", "contradicts",
    "depends_on", "implements", "improves", "causes", "compares_with",
    "derived_from", "used_for", "evidence_for", "mentions", "similar_to",
    "belongs_to",  # 新增
    "root",        # 新增
})
```

`schemas.py` 的 NODE_TYPES / RELATION_TYPES 列表同步追加 `"partition"`, `"person"` 和 `"root"`, `"belongs_to"`。

**Step 2: 前端类型扩展**

`types/graph.ts`：
- `NodeType` 联合追加 `| 'partition' | 'person'`
- `RelationType` 联合追加 `| 'root' | 'belongs_to'`
- `NODE_COLORS` 追加 `partition: '#6366f1', person: '#fbbf24'`
- `NODE_TYPES` 数组追加 `'partition', 'person'`
- `RELATION_TYPES` 数组追加 `'root', 'belongs_to'`

**Step 3: 验证**

```bash
cd backend && python -c "import ast; ast.parse(open('app/core/graph_extractor.py').read()); print('OK')"
cd frontend && ./node_modules/.bin/tsc --noEmit
```

预期：两个命令都无错误。

**Step 4: Commit**

```bash
git add backend/app/core/graph_extractor.py backend/app/models/schemas.py frontend/src/types/graph.ts
git commit -m "feat: add partition and person node types, root and belongs_to relation types"
```

---

### Task 2: GraphStore.ensure_me_node()

**Files:**
- Modify: `backend/app/core/graph_store.py`

**Step 1: 新增 ensure_me_node 方法**

在 `GraphStore` 类中新增：

```python
async def ensure_me_node(self) -> UUID:
    """获取或创建唯一的 person 节点（"我"）。"""
    result = await self.db.execute(
        select(Node).where(
            and_(Node.node_type == "person", Node.status == "active")
        ).limit(1)
    )
    me = result.scalar_one_or_none()
    if me:
        return me.id
    me_id = await self.create_node(
        node_type="person",
        name="我",
        description="知识图谱中心节点",
    )
    await self.db.flush()
    return me_id
```

**Step 2: 验证**

```bash
cd backend && python -c "import ast; ast.parse(open('app/core/graph_store.py').read()); print('OK')"
```

**Step 3: Commit**

```bash
git add backend/app/core/graph_store.py
git commit -m "feat: add ensure_me_node to GraphStore"
```

---

### Task 3: PartitionService + 分区 CRUD API

**Files:**
- Create: `backend/app/services/partition_service.py`
- Create: `backend/app/api/partitions.py`
- Modify: `backend/app/main.py` (注册 router)
- Modify: `backend/app/models/schemas.py` (分区请求/响应模型)
- Modify: `frontend/src/api/client.ts` (分区 API 函数)

**Step 1: schemas.py 新增分区模型**

```python
# ── Partition ──

class PartitionCreateRequest(BaseModel):
    name: str
    description: str = ""

class PartitionUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class PartitionResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    article_count: int = 0
    topic_count: int = 0
```

**Step 2: partition_service.py**

```python
"""Service for managing partition nodes (personal knowledge domains)."""

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from ..models.db_models import Node, Edge
from ..core.graph_store import GraphStore
from ..core.embedding_client import EmbeddingClient
from ..core.vector_store import VectorStore

logger = logging.getLogger(__name__)


class PartitionService:
    """CRUD + embedding management for partition nodes."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_store = GraphStore(db)
        self.embedding = EmbeddingClient()
        self.vector_store = VectorStore(db)

    async def list_partitions(self) -> list[dict]:
        result = await self.db.execute(
            select(Node).where(
                and_(Node.node_type == "partition", Node.status == "active")
            ).order_by(Node.created_at.desc())
        )
        partitions = result.scalars().all()

        out = []
        for p in partitions:
            article_count = await self._count_edges(p.id, "belongs_to")
            topic_count = await self._count_edges(p.id, "part_of")
            out.append({
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "article_count": article_count,
                "topic_count": topic_count,
            })
        return out

    async def _count_edges(self, partition_id: UUID, relation_type: str) -> int:
        result = await self.db.execute(
            select(func.count(Edge.id)).where(
                and_(
                    Edge.target_node_id == partition_id,
                    Edge.relation_type == relation_type,
                    Edge.status == "active",
                )
            )
        )
        return result.scalar() or 0

    async def create_partition(self, name: str, description: str = "") -> dict:
        me_id = await self.graph_store.ensure_me_node()

        partition_id = await self.graph_store.create_node(
            node_type="partition",
            name=name,
            description=description,
        )

        # me --root--> partition
        await self.graph_store.create_edge(
            source_id=me_id,
            target_id=partition_id,
            relation_type="root",
            confidence=1.0,
        )

        # 生成 embedding
        try:
            emb = await self.embedding.embed(f"{name} {description}".strip())
            await self.vector_store.upsert_node_embedding(partition_id, emb)
        except Exception as e:
            logger.warning(f"Partition embedding failed: {e}")

        await self.db.commit()
        return {"id": str(partition_id), "name": name, "description": description}

    async def update_partition(
        self, partition_id: str, name: Optional[str] = None, description: Optional[str] = None
    ) -> Optional[dict]:
        result = await self.db.execute(
            select(Node).where(Node.id == partition_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None

        desc_changed = False
        if name is not None:
            node.name = name
        if description is not None:
            node.description = description
            desc_changed = True

        await self.db.flush()

        # description 变更时重新生成 embedding
        if desc_changed:
            try:
                emb = await self.embedding.embed(f"{node.name} {node.description or ''}".strip())
                await self.vector_store.upsert_node_embedding(UUID(partition_id), emb)
            except Exception as e:
                logger.warning(f"Partition embedding update failed: {e}")

        await self.db.commit()
        return {"id": str(node.id), "name": node.name, "description": node.description}

    async def delete_partition(self, partition_id: str) -> Optional[dict]:
        result = await self.db.execute(
            select(Node).where(Node.id == partition_id)
        )
        node = result.scalar_one_or_none()
        if not node:
            return None

        node.status = "deleted"
        await self.db.commit()
        return {"id": str(node.id), "status": "deleted"}
```

**Step 3: api/partitions.py**

```python
"""API routes for partition management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import PartitionCreateRequest, PartitionUpdateRequest
from ..services.partition_service import PartitionService

router = APIRouter()


@router.get("/partitions")
async def list_partitions(db: AsyncSession = Depends(get_db)):
    service = PartitionService(db)
    return await service.list_partitions()


@router.post("/partitions")
async def create_partition(
    data: PartitionCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    return await service.create_partition(data.name, data.description)


@router.put("/partitions/{partition_id}")
async def update_partition(
    partition_id: str,
    data: PartitionUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    result = await service.update_partition(partition_id, data.name, data.description)
    if not result:
        raise HTTPException(status_code=404, detail="Partition not found")
    return result


@router.delete("/partitions/{partition_id}")
async def delete_partition(
    partition_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = PartitionService(db)
    result = await service.delete_partition(partition_id)
    if not result:
        raise HTTPException(status_code=404, detail="Partition not found")
    return result
```

**Step 4: main.py 注册 router**

在 `app.include_router(...)` 区域新增：

```python
from .api import documents, draft_graphs, insertion, graph, search, qa, extraction, clustering, partitions
# ...
app.include_router(partitions.router, prefix="/api", tags=["partitions"])
```

**Step 5: 前端 API 客户端**

`frontend/src/api/client.ts` 新增：

```typescript
// ── Partitions ──

export async function listPartitions() {
  const res = await api.get('/partitions');
  return res.data;
}

export async function createPartition(name: string, description: string = '') {
  const res = await api.post('/partitions', { name, description });
  return res.data;
}

export async function updatePartition(partitionId: string, data: { name?: string; description?: string }) {
  const res = await api.put(`/partitions/${partitionId}`, data);
  return res.data;
}

export async function deletePartition(partitionId: string) {
  const res = await api.delete(`/partitions/${partitionId}`);
  return res.data;
}
```

**Step 6: 验证**

```bash
cd backend && python -c "import ast; ast.parse(open('app/services/partition_service.py').read()); ast.parse(open('app/api/partitions.py').read()); ast.parse(open('app/main.py').read()); print('OK')"
cd frontend && ./node_modules/.bin/tsc --noEmit
```

手动测试（需后端运行 + 数据库就绪）：
```bash
curl -X POST http://localhost:8000/api/partitions -H 'Content-Type: application/json' -d '{"name":"智能体","description":"AI Agent相关"}'
curl http://localhost:8000/api/partitions
```

**Step 7: Commit**

```bash
git add backend/app/services/partition_service.py backend/app/api/partitions.py backend/app/main.py backend/app/models/schemas.py frontend/src/api/client.ts
git commit -m "feat: add partition CRUD API and service"
```

---

### Task 4: ClusteringPlanner 分区匹配

**Files:**
- Modify: `backend/app/core/clustering_planner.py`

**Step 1: 新增分区匹配方法**

在 `ClusteringPlanner` 类中新增常量和方法：

```python
_PARTITION_MATCH_THRESHOLD = 0.72

_PARTITION_SUGGEST_SYSTEM_PROMPT = (
    "你是一个个人知识库的分区规划模块。\n\n"
    "你将收到一篇新文章的标题、摘要、主题标签，以及用户已有的分区列表。\n"
    "请判断这篇文章是否应该创建一个新分区。\n\n"
    "规则：\n"
    "1. 如果文章聚焦的领域已有分区覆盖，返回 match_existing=true\n"
    "2. 如果文章属于全新领域，建议创建新分区，返回分区名和描述\n"
    "3. 分区名应简洁（2-6字），描述应概括该分区关注的主题范围\n"
    "4. 不要与已有分区名重复\n\n"
    "输出严格 JSON：\n"
    '{"match_existing": false, "partition_name": "分区名", "description": "描述", "reason": "原因"}'
)
```

新增 `match_partition` 方法：

```python
async def match_partition(
    self,
    article_title: str,
    article_summary: str,
    tags: list[dict[str, Any]],
) -> dict[str, Any]:
    """匹配文章到最合适的分区，或建议新分区。

    返回:
      {"action": "MATCH", "target_partition_id": ..., "score": ..., "candidates": [...]}
      {"action": "NEW", "proposed_name": ..., "proposed_description": ..., "reason": ...}
    """
    # Step 1: 摘要向量匹配
    summary_emb = await self.embedding.embed(article_summary)
    summary_hits = await self.vector_store.search_nodes(
        query_embedding=summary_emb,
        top_k=3,
        node_type="partition",
    )

    # Step 2: 标签向量匹配
    tag_scores: dict[str, float] = {}
    for tag in tags:
        try:
            tag_emb = await self.embedding.embed(tag["name"])
            tag_hits = await self.vector_store.search_nodes(
                query_embedding=tag_emb,
                top_k=1,
                node_type="partition",
            )
            for hit in tag_hits:
                pid = hit["id"]
                if pid not in tag_scores or hit["score"] > tag_scores[pid]:
                    tag_scores[pid] = hit["score"]
        except Exception as e:
            logger.warning(f"Tag partition match failed for '{tag['name']}': {e}")

    # Step 3: 综合评分
    all_pids = set(hit["id"] for hit in summary_hits) | set(tag_scores.keys())
    scored: list[dict] = []
    summary_map = {hit["id"]: hit for hit in summary_hits}

    for pid in all_pids:
        s_score = summary_map.get(pid, {}).get("score", 0.0)
        t_score = tag_scores.get(pid, 0.0)
        combined = 0.6 * s_score + 0.4 * t_score
        node_info = summary_map.get(pid, {})
        scored.append({
            "id": pid,
            "name": node_info.get("name", ""),
            "description": node_info.get("description", ""),
            "score": round(combined, 4),
            "summary_score": round(s_score, 4),
            "tag_score": round(t_score, 4),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    # Step 4: 决策
    if scored and scored[0]["score"] >= _PARTITION_MATCH_THRESHOLD:
        best = scored[0]
        return {
            "action": "MATCH",
            "target_partition_id": best["id"],
            "target_partition_name": best["name"],
            "score": best["score"],
            "candidates": [
                {"id": c["id"], "name": c["name"], "score": c["score"]}
                for c in scored[:3]
            ],
            "reason": f"摘要+标签综合相似度 {best['score']:.2f}",
        }

    # 未匹配 → LLM 建议新分区
    existing_names = [c["name"] for c in scored]
    suggestion = await self._suggest_new_partition(
        article_title, article_summary, tags, existing_names
    )
    suggestion["candidates"] = [
        {"id": c["id"], "name": c["name"], "score": c["score"]}
        for c in scored[:3]
    ]
    return suggestion

async def _suggest_new_partition(
    self,
    article_title: str,
    article_summary: str,
    tags: list[dict[str, Any]],
    existing_partition_names: list[str],
) -> dict[str, Any]:
    """让 LLM 建议新分区名和描述。"""
    user_prompt = json.dumps({
        "article_title": article_title,
        "article_summary": article_summary,
        "topic_tags": [t["name"] for t in tags],
        "existing_partition_names": existing_partition_names,
    }, ensure_ascii=False, indent=2)

    try:
        raw = await self.llm.generate_json(
            _PARTITION_SUGGEST_SYSTEM_PROMPT, user_prompt
        )
        if raw.get("match_existing") and scored := existing_partition_names:
            # LLM 认为应该匹配已有（但我们已经判定不够相似，退化为取最高分）
            return {
                "action": "NEW",
                "proposed_name": "",
                "proposed_description": "",
                "reason": "LLM建议匹配已有但相似度不足，请手动选择",
            }
        return {
            "action": "NEW",
            "proposed_name": raw.get("partition_name", ""),
            "proposed_description": raw.get("description", ""),
            "reason": raw.get("reason", "现有分区无强匹配"),
        }
    except Exception as e:
        logger.warning(f"Partition suggestion LLM call failed: {e}")
        return {
            "action": "NEW",
            "proposed_name": "",
            "proposed_description": "",
            "reason": "LLM调用失败，请手动输入分区名",
        }
```

**Step 2: 验证**

```bash
cd backend && python -c "import ast; ast.parse(open('app/core/clustering_planner.py').read()); print('OK')"
```

**Step 3: Commit**

```bash
git add backend/app/core/clustering_planner.py
git commit -m "feat: add partition matching to ClusteringPlanner"
```

---

### Task 5: ClusteringService 改造

**Files:**
- Modify: `backend/app/services/clustering_service.py`

**Step 1: generate_proposal 增加 partition_action**

在 `generate_proposal` 方法中，tag 匹配之前调用 `self.planner.match_partition()`：

```python
async def generate_proposal(self, document_id: str, draft_graph_json: dict) -> dict:
    # ... 现有文档查询代码 ...

    title = doc.title
    summary = draft_graph_json.get("summary", doc.summary or "")

    tags = [
        {"name": t["name"], "confidence": t.get("confidence", 0.8)}
        for t in draft_graph_json.get("topic_tags", [])
    ]

    if not tags:
        for node in draft_graph_json.get("nodes", []):
            if node.get("node_type") == "topic":
                tags.append({"name": node["name"], "confidence": 0.8})

    # ── 新增：分区匹配 ──
    partition_action = await self.planner.match_partition(title, summary, tags)

    # 现有聚类提案逻辑
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
    # ... 后续不变 ...
```

**Step 2: apply_proposal 处理分区**

在 `apply_proposal` 方法开头（tag 处理之前），新增分区处理：

```python
async def apply_proposal(self, proposal_id: str) -> dict:
    # ... 现有 proposal 查询代码 ...

    proposal = prop.proposal_json
    document_id = proposal["document_id"]
    partition_action = proposal.get("partition_action", {})
    tag_actions = proposal.get("tag_actions", [])
    topic_edges = proposal.get("topic_edges", [])

    # ── 新增：处理分区归属 ──
    partition_id = None
    if partition_action:
        me_id = await self.graph_store.ensure_me_node()

        if partition_action.get("action") == "NEW":
            pname = partition_action.get("proposed_name", "").strip()
            pdesc = partition_action.get("proposed_description", "")
            if pname:
                partition_id = await self.graph_store.create_node(
                    node_type="partition",
                    name=pname,
                    description=pdesc,
                )
                # me --root--> partition
                await self.graph_store.create_edge(
                    source_id=me_id,
                    target_id=partition_id,
                    relation_type="root",
                    confidence=1.0,
                )
                # embedding
                try:
                    emb = await self.embedding.embed(f"{pname} {pdesc}".strip())
                    await self.vector_store.upsert_node_embedding(partition_id, emb)
                except Exception as e:
                    logger.warning(f"New partition embedding failed: {e}")
                applied.append(f"NEW partition: {pname}")
        elif partition_action.get("action") == "MATCH":
            target_id = partition_action.get("target_partition_id")
            if target_id:
                from uuid import UUID
                partition_id = UUID(target_id)
                applied.append(f"MATCH partition: {partition_action.get('target_partition_name', '')}")

    # ── tag_actions 处理时记录新建 topic 的 id ──
    tag_to_topic_id: dict[str, str] = {}
    # ... 现有 tag 处理逻辑，不变 ...
    # 但在 NEW topic 创建后，追加 part_of 边:
    # if partition_id:
    #     await self.graph_store.create_edge(
    #         source_id=topic_id, target_id=partition_id,
    #         relation_type="part_of", confidence=0.8,
    #     )

    # ── article 创建后追加 belongs_to ──
    # 在现有 article 节点创建代码之后:
    if partition_id:
        try:
            await self.graph_store.create_edge(
                source_id=article_id,
                target_id=partition_id,
                relation_type="belongs_to",
                confidence=1.0,
                evidence_document_id=document_id,
            )
            applied.append(f"EDGE article -> partition (belongs_to)")
        except Exception as e:
            failed.append(f"Article belongs_to partition: {e}")

    # ... 现有 topic_edges 和收尾逻辑不变 ...
```

**关键实现细节**：
- 在 tag_actions 的 NEW 分支中，topic 创建后如果 `partition_id` 存在，追加 `topic --part_of--> partition` 边
- MERGE 的 topic 如果目标 topic 还没有 part_of 任何分区，也追加 part_of 边（查一下现有边即可）
- article 创建后无条件追加 belongs_to 边（如果 partition_id 存在）

**Step 3: 验证**

```bash
cd backend && python -c "import ast; ast.parse(open('app/services/clustering_service.py').read()); print('OK')"
```

手动测试（完整流程）：导入文章 → 抽取 → 确认 → 查看聚类提案 JSON 是否含 partition_action 字段。

**Step 4: Commit**

```bash
git add backend/app/services/clustering_service.py
git commit -m "feat: integrate partition matching into clustering proposal flow"
```

---

### Task 6: 前端类型扩展（PartitionAction）

**Files:**
- Modify: `frontend/src/types/graph.ts`

**Step 1: 新增 PartitionAction 类型和扩展 ClusteringProposalJSON**

```typescript
// ── Partition Action ──

export type PartitionAction = {
  action: 'MATCH' | 'NEW';
  target_partition_id?: string;
  target_partition_name?: string;
  proposed_name?: string;
  proposed_description?: string;
  score: number;
  candidates: Array<{
    id: string;
    name: string;
    score: number;
  }>;
  reason: string;
};
```

`ClusteringProposalJSON` 类型追加字段：

```typescript
export type ClusteringProposalJSON = {
  article_title: string;
  article_summary: string;
  document_id: string;
  partition_action: PartitionAction;  // 新增
  tag_actions: TagAction[];
  topic_edges: TopicEdgeProposal[];
};
```

**Step 2: 验证**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/types/graph.ts
git commit -m "feat: add PartitionAction type to frontend"
```

---

### Task 7: 聚类提案页分区选择 UI

**Files:**
- Modify: `frontend/src/pages/ClusteringProposalPage.tsx`
- Modify: `frontend/src/api/client.ts` (新增 listPartitions import 如果需要)

**Step 1: 新增分区选择卡片**

在 `ClusteringProposalPage.tsx` 的 tag_actions 渲染之前，新增分区选择区块。需要新增 state 管理：

```typescript
const [partitionMode, setPartitionMode] = useState<'auto' | 'match' | 'new'>('auto');
const [selectedPartitionId, setSelectedPartitionId] = useState<string>('');
const [newPartitionName, setNewPartitionName] = useState('');
const [newPartitionDesc, setNewPartitionDesc] = useState('');
const [allPartitions, setAllPartitions] = useState<Array<{id:string;name:string;description?:string}>>([]);
```

初始化逻辑（useEffect 中根据 proposal.partition_action 设置默认值）：
- 如果 `action === 'MATCH'`：`partitionMode='auto'`，`selectedPartitionId=target_partition_id`
- 如果 `action === 'NEW'`：`partitionMode='auto'`，`newPartitionName=proposed_name`，`newPartitionDesc=proposed_description`

同时加载所有分区列表（`listPartitions()`）供手动切换。

UI 卡片设计：

```tsx
{/* 分区归属卡片 */}
<div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
  <h3 style={{ fontSize: 15, margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
    📁 分区归属
    {proposal.partition_action?.action === 'NEW' && (
      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
        建议新建分区
      </span>
    )}
    {proposal.partition_action?.action === 'MATCH' && (
      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#dbeafe', color: '#1d4ed8' }}>
        匹配到「{proposal.partition_action.target_partition_name}」({(proposal.partition_action.score * 100).toFixed(0)}%)
      </span>
    )}
  </h3>

  {proposal.partition_action?.reason && (
    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{proposal.partition_action.reason}</div>
  )}

  {/* 模式切换 */}
  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
    <button
      onClick={() => setPartitionMode('auto')}
      style={partitionMode === 'auto' ? activeBtnStyle : inactiveBtnStyle}
    >
      按建议
    </button>
    <button
      onClick={() => setPartitionMode('match')}
      style={partitionMode === 'match' ? activeBtnStyle : inactiveBtnStyle}
    >
      挂载已有
    </button>
    <button
      onClick={() => setPartitionMode('new')}
      style={partitionMode === 'new' ? activeBtnStyle : inactiveBtnStyle}
    >
      新建分区
    </button>
  </div>

  {/* auto: 显示建议内容（只读） */}
  {partitionMode === 'auto' && proposal.partition_action?.action === 'MATCH' && (
    <div style={{ fontSize: 14 }}>
      → {proposal.partition_action.target_partition_name}
    </div>
  )}
  {partitionMode === 'auto' && proposal.partition_action?.action === 'NEW' && (
    <div style={{ fontSize: 14 }}>
      → 新建「{proposal.partition_action.proposed_name}」{proposal.partition_action.proposed_description}
    </div>
  )}

  {/* match: 下拉选择已有分区 */}
  {partitionMode === 'match' && (
    <select
      value={selectedPartitionId}
      onChange={e => setSelectedPartitionId(e.target.value)}
      style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14 }}
    >
      <option value="">请选择分区...</option>
      {allPartitions.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )}

  {/* new: 可编辑分区名和描述 */}
  {partitionMode === 'new' && (
    <div>
      <input
        value={newPartitionName}
        onChange={e => setNewPartitionName(e.target.value)}
        placeholder="分区名（如：智能体）"
        style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, marginBottom: 6 }}
      />
      <input
        value={newPartitionDesc}
        onChange={e => setNewPartitionDesc(e.target.value)}
        placeholder="分区描述..."
        style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}
      />
    </div>
  )}

  {/* 候选列表 */}
  {proposal.partition_action?.candidates?.length > 0 && partitionMode !== 'new' && (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>其他候选分区:</div>
      {proposal.partition_action.candidates.map(c => (
        <div key={c.id} style={{ fontSize: 12, color: '#64748b', padding: '2px 0' }}>
          {c.name} — {(c.score * 100).toFixed(0)}%
        </div>
      ))}
    </div>
  )}
</div>
```

按钮样式常量：
```typescript
const activeBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const inactiveBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#fff', color: '#64748b',
  border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
```

**Step 2: handleApply 注入 partition_action**

在 `handleApply` 中，根据用户选择的模式构造 partition_action 并写入 proposal：

```typescript
const handleApply = async () => {
  if (!id || !proposal) return;
  setApplying(true);
  try {
    // 构造最终的 partition_action
    let finalPartitionAction = proposal.partition_action;
    if (partitionMode === 'match' && selectedPartitionId) {
      const target = allPartitions.find(p => p.id === selectedPartitionId);
      finalPartitionAction = {
        ...finalPartitionAction,
        action: 'MATCH',
        target_partition_id: selectedPartitionId,
        target_partition_name: target?.name || '',
      };
    } else if (partitionMode === 'new' && newPartitionName.trim()) {
      finalPartitionAction = {
        ...finalPartitionAction,
        action: 'NEW',
        proposed_name: newPartitionName.trim(),
        proposed_description: newPartitionDesc,
      };
    }
    // partitionMode === 'auto' 时保持原值

    const updated = {
      ...proposal,
      partition_action: finalPartitionAction,
      tag_actions: editedActions,
    };
    await updateClusteringProposal(id, updated);
    const result = await applyClusteringProposal(id);
    // ... 后续不变 ...
  }
};
```

**Step 3: 验证**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

手动测试：走完导入→抽取→确认流程，聚类提案页应显示分区选择卡片。

**Step 4: Commit**

```bash
git add frontend/src/pages/ClusteringProposalPage.tsx
git commit -m "feat: add partition selection card to clustering proposal page"
```

---

### Task 8: 全局图页层次展示

**Files:**
- Modify: `frontend/src/pages/GlobalGraphPage.tsx`
- Modify: `backend/app/api/graph.py` (GET /graph/global 支持分区视图)

**Step 1: 后端 /graph/global 支持分区**

修改 `graph.py` 的 `get_global_graph`，新增 `partition` filter_type：

```python
@router.get("/graph/global")
async def get_global_graph(
    filter_type: str = "all",
    db: AsyncSession = Depends(get_db),
):
    """Get the full global graph or filter by node type."""
    store = GraphStore(db)
    all_nodes = await store.get_all_active_nodes()

    if filter_type == "partition":
        # 分区视图：person + partition + 它们之间的边
        nodes = [n for n in all_nodes if n["node_type"] in ("person", "partition")]
    elif filter_type == "topic":
        nodes = [n for n in all_nodes if n["node_type"] == "topic"]
    elif filter_type == "article":
        nodes = [n for n in all_nodes if n["node_type"] == "article"]
    else:
        # all: 包含 person + partition + topic + article
        nodes = [n for n in all_nodes if n["node_type"] in ("person", "partition", "topic", "article")]

    node_ids = [UUID(n["id"]) for n in nodes]
    edges = await store.get_edges_for_nodes(node_ids) if node_ids else []

    return {"nodes": nodes, "edges": edges}
```

**Step 2: 前端 GlobalGraphPage 过滤器新增 partition 视图**

修改 `FilterType` 和过滤按钮：

```typescript
type FilterType = 'all' | 'partition' | 'topic' | 'article';
```

过滤按钮组追加 partition：

```tsx
{(['all', 'partition', 'topic', 'article'] as FilterType[]).map(ft => (
  <button key={ft} onClick={() => setFilterType(ft)} style={{
    padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
    background: filterType === ft ? '#3b82f6' : '#f1f5f9',
    color: filterType === ft ? '#fff' : '#64748b', border: 'none',
  }}>
    {ft === 'all' ? `全部` : ft === 'partition' ? '分区' : ft === 'topic' ? `主题` : `文章`}
  </button>
))}
```

统计行同步更新，加入 partition 计数：

```typescript
const partitionCount = graphData.nodes.filter(n => n.nodeType === 'partition').length;
const personCount = graphData.nodes.filter(n => n.nodeType === 'person').length;
```

**Step 3: GraphEditor 节点渲染（如需调整样式）**

检查 `GraphEditor.tsx`，确保新节点类型有合理默认渲染。person 节点金色、partition 节点靛蓝已由 NODE_COLORS 定义。如果 GraphEditor 按颜色渲染则无需改动。

**Step 4: 验证**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
cd backend && python -c "import ast; ast.parse(open('app/api/graph.py').read()); print('OK')"
```

手动测试：创建分区 + 导入文章入库后，全局图页面切换"分区"视图应看到"我"→分区结构。

**Step 5: Commit**

```bash
git add frontend/src/pages/GlobalGraphPage.tsx backend/app/api/graph.py
git commit -m "feat: global graph supports partition and person node display"
```

---

## 实现顺序与依赖

```
Task 1 (类型白名单) ── 无依赖，先做
  ├── Task 2 (ensure_me_node) ── 依赖 Task 1
  ├── Task 6 (前端类型) ── 依赖 Task 1
  │
Task 3 (PartitionService + API) ── 依赖 Task 1, 2
Task 4 (ClusteringPlanner 匹配) ── 依赖 Task 1, 2
Task 5 (ClusteringService 改造) ── 依赖 Task 3, 4
  │
Task 7 (提案页 UI) ── 依赖 Task 5, 6
Task 8 (全局图 UI) ── 依赖 Task 6
```

Task 7 和 Task 8 可并行。

## 最终验证清单

完成后逐项确认：

1. `POST /api/partitions` 能创建分区，`GET /api/partitions` 能列出
2. 导入文章 → 抽取 → 确认 → 聚类提案页显示分区选择卡片
3. 首次使用（无分区）时，提案页建议新分区
4. 已有分区时，提案页匹配到相似度最高的分区
5. 用户可手动切换"挂载已有"/"新建分区"
6. 应用提案后，全局图 `/graph/global?filter_type=partition` 显示 `我 → 分区`
7. 全局图 `all` 视图显示完整的 `我 → 分区 → topic → article` 层次
8. `tsc --noEmit` 零错误
9. 后端所有改动文件 `ast.parse` 通过
