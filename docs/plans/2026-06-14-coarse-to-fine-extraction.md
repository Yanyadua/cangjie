# 粗粒度渐进式抽取 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将3阶段抽取（概念→实体→关系）重构为2阶段（主题骨架→自动展开），从粗粒度到细粒度，减少审核负担。

**Architecture:** Step 1 用 LLM 抽取摘要+topic标签+核心claim（骨架）。Step 2 围绕每个claim一次性展开实体+关系。数据模型不变，下游完全复用。聚类阶段直接复用骨架的 topic_tags，省掉 tag_generator 调用。

**Tech Stack:** FastAPI, SQLAlchemy async, React/TypeScript, DeepSeek LLM, DashScope Embedding

---

### Task 1: 后端 — 新增骨架抽取方法

**Files:**
- Modify: `backend/app/core/graph_extractor.py`

**Step 1: 添加骨架抽取 prompt 和方法**

在 `graph_extractor.py` 中，在 `# ── Stage prompts ──` section 之前，添加新的 prompt 常量：

```python
# ── Progressive extraction prompts ──

_SKELETON_SYSTEM = (
    "你是一个知识抽取模块。你的任务是分析文章并提取主题骨架（粗粒度）。\n\n"
    "要求：\n"
    "1. summary：1-2句话概括文章核心内容\n"
    "2. topic_tags：3-5个主题标签（文章属于哪些领域/话题），每个标签给出 confidence（0-1）\n"
    "3. core_claims：2-4个文章的核心主张/观点，每个claim要有清晰的name和简短的description\n"
    "   - claim应该是文章明确表达的观点，不是中性的事实描述\n"
    "   - 例如：「GraphRAG在全局理解任务上优于传统RAG」而不是「GraphRAG是一种方法」\n"
    "4. 不要提取具体实体（人名、组织名等），只关注文章层面的大局\n"
    "5. 输出严格 JSON，不要输出 Markdown\n\n"
    "输出格式：\n"
    '{\n'
    '  "summary": "文章摘要",\n'
    '  "topic_tags": [\n'
    '    {"name": "标签名", "confidence": 0.95}\n'
    '  ],\n'
    '  "core_claims": [\n'
    '    {"name": "核心主张", "description": "简短说明"}\n'
    '  ]\n'
    '}\n\n'
    "示例：\n"
    f"输入：{_FEWSHOT_INPUT}\n"
    f"输出：{json.dumps({\n"
    '    "summary": "本文介绍了微软研究院提出的 GraphRAG 方法，通过知识图谱和社区检测改进传统 RAG 的全局推理能力。",\n'
    '    "topic_tags": [\n'
    '        {"name": "检索增强生成", "confidence": 0.95},\n'
    '        {"name": "知识图谱", "confidence": 0.9},\n'
    '        {"name": "社区检测", "confidence": 0.8}\n'
    '    ],\n'
    '    "core_claims": [\n'
    '        {"name": "GraphRAG在全局理解任务上优于传统RAG", "description": "通过知识图谱和社区摘要，解决了传统RAG跨文档推理弱的问题"},\n'
    '        {"name": "社区检测是GraphRAG的关键步骤", "description": "使用Leiden算法将图谱划分为局部子图，为每个社区生成摘要"}\n'
    '    ]\n'
    '}, ensure_ascii=False, indent=2)}'
)

_EXPAND_SYSTEM = (
    "你是一个知识图谱展开模块。基于文章的主题骨架（摘要+标签+核心claim），展开具体的实体节点和关系。\n\n"
    "要求：\n"
    "1. 为每个 topic_tag 创建一个 topic 类型节点\n"
    "2. 为每个 core_claim 创建一个 claim 类型节点\n"
    "3. 创建一个 article 类型节点代表文章整体\n"
    "4. 围绕每个 claim，抽取支撑它的具体实体（person, method, concept, tool, organization 等）\n"
    "5. 抽取节点之间的关系，每条关系必须有 evidence（引用原文）\n"
    + _RELATION_GUIDANCE +
    "\n6. article 节点通过 tag 关系连接到所有 topic 节点\n"
    "7. article 节点通过 contains 关系连接到所有 claim 节点\n"
    "8. 输出严格 JSON，不要输出 Markdown\n"
    "9. node_type 只能使用：article, concept, claim, topic, person, organization, paper, project, "
    "framework, tool, method, technology, question\n\n"
    "示例：\n"
    f"输出：{json.dumps({
        'nodes': [
            {'temp_id': 'a1', 'node_type': 'article', 'name': 'GraphRAG：基于知识图谱的检索增强生成', 'description': '文章整体节点'},
            {'temp_id': 't1', 'node_type': 'topic', 'name': '检索增强生成', 'description': ''},
            {'temp_id': 't2', 'node_type': 'topic', 'name': '知识图谱', 'description': ''},
            {'temp_id': 'c1', 'node_type': 'claim', 'name': 'GraphRAG在全局理解任务上优于传统RAG', 'description': '通过知识图谱+社区检测改进跨文档推理'},
            {'temp_id': 'c2', 'node_type': 'claim', 'name': '社区检测是GraphRAG的关键步骤', 'description': '使用Leiden算法划分子图'},
            {'temp_id': 'n1', 'node_type': 'method', 'name': 'GraphRAG', 'description': '微软研究院提出的基于知识图谱的RAG方法'},
            {'temp_id': 'n2', 'node_type': 'method', 'name': '社区检测', 'description': '将图谱划分为局部子图的算法'},
            {'temp_id': 'n3', 'node_type': 'method', 'name': 'Leiden算法', 'description': 'GraphRAG中使用的社区检测算法'},
            {'temp_id': 'n4', 'node_type': 'concept', 'name': '传统RAG', 'description': '基于向量相似度的检索增强生成'},
            {'temp_id': 'n5', 'node_type': 'organization', 'name': '微软研究院', 'description': '提出GraphRAG的研究机构'}
        ],
        'edges': [
            {'temp_id': 'e1', 'source': 'a1', 'target': 't1', 'relation_type': 'tag', 'confidence': 1.0, 'evidence': '文章主题涉及检索增强生成'},
            {'temp_id': 'e2', 'source': 'a1', 'target': 't2', 'relation_type': 'tag', 'confidence': 1.0, 'evidence': '文章主题涉及知识图谱'},
            {'temp_id': 'e3', 'source': 'a1', 'target': 'c1', 'relation_type': 'contains', 'confidence': 1.0, 'evidence': '文章核心主张'},
            {'temp_id': 'e4', 'source': 'a1', 'target': 'c2', 'relation_type': 'contains', 'confidence': 1.0, 'evidence': '文章核心主张'},
            {'temp_id': 'e5', 'source': 'c1', 'target': 'n1', 'relation_type': 'supports', 'confidence': 0.9, 'evidence': 'GraphRAG是微软研究院提出的一种基于知识图谱的检索增强生成方法'},
            {'temp_id': 'e6', 'source': 'c1', 'target': 'n4', 'relation_type': 'improves', 'confidence': 0.95, 'evidence': 'GraphRAG在需要全局理解的数据集上显著优于传统RAG方法'},
            {'temp_id': 'e7', 'source': 'c2', 'target': 'n2', 'relation_type': 'depends_on', 'confidence': 0.9, 'evidence': '利用社区检测算法将图谱划分为多个局部子图'},
            {'temp_id': 'e8', 'source': 'n2', 'target': 'n3', 'relation_type': 'implements', 'confidence': 0.9, 'evidence': '社区检测通常使用Leiden算法'},
            {'temp_id': 'e9', 'source': 'n1', 'target': 'n5', 'relation_type': 'belongs_to', 'confidence': 1.0, 'evidence': 'GraphRAG是微软研究院提出的'}
        ]
    }, ensure_ascii=False, indent=2)}"
)
```

然后在 `GraphExtractor` 类中，在 `# ── Individual stage methods` 注释之前，添加两个新方法：

```python
    # ── Progressive extraction methods ──

    async def run_skeleton(self, title: str, content: str) -> dict:
        """Step 1: Extract article skeleton (summary + topic tags + core claims)."""
        logger.info("Step 1: Extracting skeleton (summary + tags + claims)")
        article_prompt = f"文章标题：{title}\n\n文章内容：\n{content}"

        raw = await self._llm.generate_json(system_prompt=_SKELETON_SYSTEM, user_prompt=article_prompt)
        skeleton = _parse_json_response(raw)
        if not skeleton:
            raise ValueError("Skeleton extraction returned invalid response")

        skeleton.setdefault("summary", "")
        skeleton.setdefault("topic_tags", [])
        skeleton.setdefault("core_claims", [])
        logger.info(
            "Step 1 complete: %d tags, %d claims",
            len(skeleton["topic_tags"]), len(skeleton["core_claims"]),
        )
        return skeleton

    async def run_expand(self, title: str, content: str, skeleton: dict) -> dict:
        """Step 2: Expand skeleton into full graph (nodes + edges in one call)."""
        logger.info("Step 2: Expanding skeleton into full graph")

        expand_prompt = (
            f"文章标题：{title}\n\n文章内容：\n{content}\n\n"
            f"主题骨架：\n{json.dumps(skeleton, ensure_ascii=False, indent=2)}\n\n"
            "请基于以上骨架，展开完整的实体节点和关系。"
        )
        raw = await self._llm.generate_json(system_prompt=_EXPAND_SYSTEM, user_prompt=expand_prompt)
        expanded = _parse_json_response(raw)
        if not expanded:
            raise ValueError("Expand step returned invalid response")

        expanded.setdefault("nodes", [])
        expanded.setdefault("edges", [])
        logger.info("Step 2 complete: %d nodes, %d edges", len(expanded["nodes"]), len(expanded["edges"]))
        return expanded
```

**Step 2: 验证导入无语法错误**

Run: `cd backend && python -c "from app.core.graph_extractor import GraphExtractor; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/core/graph_extractor.py
git commit -m "feat: add skeleton and expand extraction methods"
```

---

### Task 2: 后端 — 重写 extraction_service.py

**Files:**
- Modify: `backend/app/services/extraction_service.py` (full rewrite of stage methods)

**Step 1: 替换所有 stage 方法为 step 方法**

将 `extraction_service.py` 的 `ExtractionService` 类中，从 `# ── Stage 1` 到 `get_status` 方法全部替换为以下内容（保留文件顶部的 imports 和 `__init__`、`_get_doc_content`、`_get_or_create_session`）：

```python
    # ── Step 1: Skeleton (summary + topic tags + core claims) ──

    async def run_step1(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        result = await self.extractor.run_skeleton(title, content)

        from uuid import uuid4
        dg = DraftGraph(
            id=uuid4(),
            document_id=document_id,
            graph_json={"step": 1, "skeleton": result},
            status="skeleton",
        )
        self.db.add(dg)
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 1, "data": result}

    async def save_step1(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found. Run step1 first."}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["skeleton"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "skeleton_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 1, "status": "saved"}

    # ── Step 2: Expand skeleton into full graph ──

    async def run_step2(self, document_id: str) -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "skeleton" not in session.get("graph_json", {}):
            return {"error": "Step 1 not completed. Run step1 first."}

        skeleton = session["graph_json"]["skeleton"]
        result = await self.extractor.run_expand(title, content, skeleton)

        result_db = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result_db.scalar_one()
        gj = dg.graph_json
        gj["step"] = 2
        gj["expanded"] = result
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "expanded"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 2, "data": result}

    async def save_step2(self, document_id: str, data: dict) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"error": "Session not found"}

        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        gj = dg.graph_json
        gj["expanded"] = data
        dg.graph_json = json.loads(json.dumps(gj))
        flag_modified(dg, "graph_json")
        dg.status = "expanded_done"
        await self.db.flush()

        return {"session_id": str(dg.id), "step": 2, "status": "saved"}

    # ── Finalize: Validate + Create Draft Graph ──

    async def finalize(self, document_id: str) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session or "expanded" not in session.get("graph_json", {}):
            return {"error": "Extraction not completed. Complete step2 first."}

        gj = session["graph_json"]
        skeleton = gj.get("skeleton", {})
        expanded = gj.get("expanded", {})

        summary = skeleton.get("summary", "")
        nodes = expanded.get("nodes", [])
        edges = expanded.get("edges", [])

        content = (await self._get_doc_content(document_id))[1]

        # Run evidence validation
        await self.extractor.validate_evidence(edges, content)

        # Calibrate confidence
        from ..core.graph_extractor import _calibrate_confidence
        edges = _calibrate_confidence(edges, content)

        # Validate and sanitize
        from ..core.graph_extractor import _validate_and_sanitize
        final = _validate_and_sanitize({"summary": summary, "nodes": nodes, "edges": edges})

        # Update draft graph
        result = await self.db.execute(select(DraftGraph).where(DraftGraph.id == session["id"]))
        dg = result.scalar_one()
        dg.graph_json = final
        dg.status = "draft"
        await self.db.flush()

        return {"draft_graph_id": str(dg.id), "status": "draft", "graph_json": final}

    # ── Get Status ──

    async def get_status(self, document_id: str) -> dict:
        session = await self._get_or_create_session(document_id)
        if not session:
            return {"step": 0, "document_id": document_id}

        gj = session.get("graph_json", {})
        return {
            "session_id": session["id"],
            "document_id": document_id,
            "step": gj.get("step", 0),
            "status": session["status"],
            "skeleton": gj.get("skeleton"),
            "expanded": gj.get("expanded"),
        }
```

**Step 2: 验证导入无语法错误**

Run: `cd backend && python -c "from app.services.extraction_service import ExtractionService; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/extraction_service.py
git commit -m "feat: rewrite extraction service for 2-step progressive flow"
```

---

### Task 3: 后端 — 更新 extraction API 路由

**Files:**
- Modify: `backend/app/api/extraction.py` (full rewrite)

**Step 1: 用新的路由替换整个文件内容**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.extraction_service import ExtractionService

router = APIRouter()


@router.get("/extraction/{document_id}/status")
async def get_extraction_status(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    return await svc.get_status(document_id)


@router.post("/extraction/{document_id}/step1")
async def run_step1(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_step1(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/step1")
async def save_step1(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_step1(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/step2")
async def run_step2(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.run_step2(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/extraction/{document_id}/step2")
async def save_step2(document_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.save_step2(document_id, data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/extraction/{document_id}/finalize")
async def finalize_extraction(document_id: str, db: AsyncSession = Depends(get_db)):
    svc = ExtractionService(db)
    result = await svc.finalize(document_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
```

**Step 2: 重启后端验证路由存在**

Run: `cd backend && python -c "from app.api.extraction import router; print([r.path for r in router.routes])"`
Expected: 路由列表包含 `/extraction/{document_id}/step1` 和 `/extraction/{document_id}/step2`，不包含 stage 路由

**Step 3: Commit**

```bash
git add backend/app/api/extraction.py
git commit -m "feat: replace stage routes with step1/step2 routes"
```

---

### Task 4: 后端 — 简化 clustering_service（复用 topic_tags）

**Files:**
- Modify: `backend/app/services/clustering_service.py:37-73` (generate_proposal method)
- Delete: `backend/app/core/tag_generator.py`

**Step 1: 修改 generate_proposal 方法**

将 `clustering_service.py` 的 `generate_proposal` 方法替换为：

```python
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

        proposal = await self.planner.generate_proposal(
            article_title=title,
            article_summary=summary,
            tags=tags,
            document_id=document_id,
        )

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
```

**Step 2: 移除 TagGenerator 导入和初始化**

在 `clustering_service.py` 中：
- 删除 `from ..core.tag_generator import TagGenerator` 导入（第15行）
- 删除 `self.tag_generator = TagGenerator(self.llm)` 行（第30行）
- 删除 `self.llm = LLMClient()` 行（第28行）— 如果 planner 不需要的话。检查：planner 已经在自己的 `__init__` 中接收 llm，所以 `self.llm` 可以删除。

**Step 3: 删除 tag_generator.py**

Run: `rm backend/app/core/tag_generator.py`

**Step 4: 验证导入**

Run: `cd backend && python -c "from app.services.clustering_service import ClusteringService; print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/app/core/tag_generator.py
git commit -m "refactor: reuse topic_tags from skeleton, remove tag_generator"
```

---

### Task 5: 前端 — 更新 types 和 API client

**Files:**
- Modify: `frontend/src/types/graph.ts` (add types after line 59)
- Modify: `frontend/src/api/client.ts:111-151` (replace stage functions)

**Step 1: 在 types/graph.ts 添加新类型**

在 `GraphData` type 之后（约第59行后）添加：

```typescript
export type TopicTag = {
  name: string;
  confidence?: number;
};

export type CoreClaim = {
  name: string;
  description: string;
};

export type SkeletonData = {
  summary: string;
  topic_tags: TopicTag[];
  core_claims: CoreClaim[];
};

export type ExpandedData = {
  nodes: Array<{
    temp_id: string;
    node_type: NodeType;
    name: string;
    description: string;
  }>;
  edges: Array<{
    temp_id: string;
    source: string;
    target: string;
    relation_type: RelationType;
    confidence: number;
    evidence: string;
  }>;
};
```

**Step 2: 替换 api/client.ts 的 Extraction Stages section**

将 `// ── Extraction Stages ──` 到 `finalizeExtraction` 之间的所有 stage 函数替换为：

```typescript
// ── Extraction Steps ──

export async function getExtractionStatus(documentId: string) {
  const res = await api.get(`/extraction/${documentId}/status`);
  return res.data;
}

export async function runStep1(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/step1`);
  return res.data;
}

export async function saveStep1(documentId: string, data: unknown) {
  const res = await api.put(`/extraction/${documentId}/step1`, data);
  return res.data;
}

export async function runStep2(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/step2`);
  return res.data;
}

export async function saveStep2(documentId: string, data: unknown) {
  const res = await api.put(`/extraction/${documentId}/step2`, data);
  return res.data;
}

export async function finalizeExtraction(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/finalize`);
  return res.data;
}
```

**Step 3: 验证前端编译**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 不应有关于 stage1/stage2/stage3 的错误（ExtractionWizardPage 会在下一个 task 修复，暂时可能有它的错误）

**Step 4: Commit**

```bash
git add frontend/src/types/graph.ts frontend/src/api/client.ts
git commit -m "feat: update types and API client for 2-step extraction"
```

---

### Task 6: 前端 — 重写 ExtractionWizardPage

**Files:**
- Modify: `frontend/src/pages/ExtractionWizardPage.tsx` (full rewrite)

**Step 1: 用以下内容替换整个文件**

```tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  runStep1, saveStep1,
  runStep2, saveStep2,
  finalizeExtraction,
} from '../api/client';
import type { NodeType, RelationType } from '../types/graph';
import { NODE_TYPES, RELATION_TYPES, NODE_COLORS } from '../types/graph';

type Tag = { name: string; confidence: number };
type Claim = { name: string; description: string };
type NodeItem = { temp_id: string; node_type: NodeType; name: string; description: string };
type EdgeItem = { temp_id: string; source: string; target: string; relation_type: RelationType; confidence: number; evidence: string };

const STEP_LABELS = ['主题骨架', '图谱展开', '确认完成'];

export default function ExtractionWizardPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState(0); // 0=loading, 1=skeleton, 2=expanded, finalize triggers navigation
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Skeleton data
  const [summary, setSummary] = useState('');
  const [topicTags, setTopicTags] = useState<Tag[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);

  // Step 2: Expanded data
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);

  useEffect(() => {
    handleRunStep1();
  }, []);

  const handleRunStep1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await runStep1(documentId);
      setSummary(res.data.summary || '');
      setTopicTags(res.data.topic_tags || []);
      setClaims(res.data.core_claims || []);
      setStep(1);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '骨架抽取失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStep1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStep1(documentId, { summary, topic_tags: topicTags, core_claims: claims });
      const res = await runStep2(documentId);
      setNodes(res.data.nodes || []);
      setEdges(res.data.edges || []);
      setStep(2);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '展开失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStep2(documentId, { nodes, edges });
      const res = await finalizeExtraction(documentId);
      navigate(`/draft/${res.draft_graph_id}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '完成失败');
    } finally {
      setLoading(false);
    }
  };

  // ── Tag helpers ──
  const updateTag = (idx: number, value: string) => {
    setTopicTags(prev => prev.map((t, i) => i === idx ? { ...t, name: value } : t));
  };
  const addTag = () => setTopicTags(prev => [...prev, { name: '', confidence: 0.8 }]);
  const removeTag = (idx: number) => setTopicTags(prev => prev.filter((_, i) => i !== idx));

  // ── Claim helpers ──
  const updateClaim = (idx: number, field: string, value: string) => {
    setClaims(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };
  const addClaim = () => setClaims(prev => [...prev, { name: '', description: '' }]);
  const removeClaim = (idx: number) => setClaims(prev => prev.filter((_, i) => i !== idx));

  // ── Node helpers ──
  const updateNode = (idx: number, field: string, value: string) => {
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  };
  const addNode = () => {
    const id = `n_${Date.now()}`;
    setNodes(prev => [...prev, { temp_id: id, node_type: 'concept' as NodeType, name: '', description: '' }]);
  };
  const removeNode = (idx: number) => {
    const removedId = nodes[idx].temp_id;
    setNodes(prev => prev.filter((_, i) => i !== idx));
    setEdges(prev => prev.filter(e => e.source !== removedId && e.target !== removedId));
  };

  // ── Edge helpers ──
  const updateEdge = (idx: number, field: string, value: string | number) => {
    setEdges(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };
  const addEdge = () => {
    const id = `e_${Date.now()}`;
    setEdges(prev => [...prev, {
      temp_id: id, source: nodes[0]?.temp_id || '', target: nodes[1]?.temp_id || '',
      relation_type: 'related_to' as RelationType, confidence: 0.8, evidence: '',
    }]);
  };
  const removeEdge = (idx: number) => setEdges(prev => prev.filter((_, i) => i !== idx));

  const nodeNameMap = Object.fromEntries(nodes.map(n => [n.temp_id, n.name]));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{
              height: 6, background: step > i + 1 ? '#10b981' : step === i + 1 ? '#3b82f6' : '#e2e8f0',
              borderRadius: i === 0 ? 3 : 0,
            }} />
            <div style={{
              fontSize: 12, marginTop: 4, textAlign: 'center',
              color: step === i + 1 ? '#3b82f6' : step > i + 1 ? '#10b981' : '#94a3b8',
              fontWeight: step === i + 1 ? 600 : 400,
            }}>
              {i + 1}. {label}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 16 }}>{error}</div>
      )}

      {/* Step 1: Skeleton */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>主题骨架</h3>

          {/* Summary */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>文章摘要</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, resize: 'vertical' }} />
          </div>

          {/* Topic Tags */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>主题标签 ({topicTags.length})</label>
            <button onClick={addTag} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加</button>
          </div>
          {topicTags.map((t, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', flexShrink: 0 }} />
              <input value={t.name} onChange={e => updateTag(idx, e.target.value)} placeholder="标签名"
                style={{ flex: 1, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <button onClick={() => removeTag(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
            </div>
          ))}

          {/* Core Claims */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>核心主张 ({claims.length})</label>
            <button onClick={addClaim} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加</button>
          </div>
          {claims.map((c, idx) => (
            <div key={idx} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', borderLeft: '3px solid #f97316' }}>
              <input value={c.name} onChange={e => updateClaim(idx, 'name', e.target.value)} placeholder="主张名称"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, fontWeight: 600, marginBottom: 4 }} />
              <input value={c.description} onChange={e => updateClaim(idx, 'description', e.target.value)} placeholder="简短说明"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }} />
              <button onClick={() => removeClaim(idx)} style={{ marginTop: 4, padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>删除</button>
            </div>
          ))}

          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button onClick={handleSaveStep1} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '处理中...' : '确认骨架并展开图谱'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Expanded Graph */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>图谱展开结果</h3>

          {/* Nodes */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>节点数: {nodes.length} | 关系数: {edges.length}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addNode} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加节点</button>
              <button onClick={addEdge} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加关系</button>
            </div>
          </div>

          {/* Node list */}
          {nodes.map((n, idx) => (
            <div key={n.temp_id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center',
              borderLeft: `3px solid ${NODE_COLORS[n.node_type] || '#94a3b8'}`, paddingLeft: 8 }}>
              <select value={n.node_type} onChange={e => updateNode(idx, 'node_type', e.target.value)}
                style={{ width: 110, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={n.name} onChange={e => updateNode(idx, 'name', e.target.value)} placeholder="名称"
                style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <input value={n.description} onChange={e => updateNode(idx, 'description', e.target.value)} placeholder="描述"
                style={{ flex: 3, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <button onClick={() => removeNode(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
            </div>
          ))}

          {/* Edge list */}
          <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: '#64748b' }}>关系列表</h4>
          {edges.map((e, idx) => (
            <div key={e.temp_id} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <select value={e.source} onChange={ev => updateEdge(idx, 'source', ev.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                  <option value="">选择源节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <select value={e.relation_type} onChange={ev => updateEdge(idx, 'relation_type', ev.target.value)}
                  style={{ flex: 1, padding: 6, border: '1px solid #3b82f6', borderRadius: 4, fontSize: 12, color: '#3b82f6' }}>
                  {RELATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={e.target} onChange={ev => updateEdge(idx, 'target', ev.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                  <option value="">选择目标节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <input type="number" min={0} max={1} step={0.05} value={e.confidence}
                  onChange={ev => updateEdge(idx, 'confidence', parseFloat(ev.target.value))}
                  style={{ width: 60, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, textAlign: 'center' }} />
                <button onClick={() => removeEdge(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
              </div>
              <input value={e.evidence} onChange={ev => updateEdge(idx, 'evidence', ev.target.value)} placeholder="证据（引用原文）"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }} />
            </div>
          ))}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>返回骨架</button>
            <button onClick={handleFinalize} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '校验中...' : '确认并生成图谱'}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {step === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>正在分析文章，提取主题骨架...</div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: 验证前端编译**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/pages/ExtractionWizardPage.tsx
git commit -m "feat: rewrite ExtractionWizardPage for 2-step progressive flow"
```

---

### Task 7: 端到端验证

**Files:** 无修改，仅测试

**Step 1: 重启后端**

Run: `cd backend && python -m uvicorn app.main:app --reload --port 8000`

**Step 2: 验证 API 路由**

Run: `curl -s http://localhost:8000/openapi.json | python -m json.tool | grep -E "step[12]|stage[123]" | head -10`
Expected: 包含 step1/step2 路由，不包含 stage 路由

**Step 3: 前端编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: 手动测试完整流程**

1. 打开浏览器 → 导入一篇文章
2. 确认看到 "主题骨架" 页面（Step 1），包含摘要、标签、claims
3. 编辑标签/claims → 点击"确认骨架并展开图谱"
4. 确认看到 "图谱展开结果" 页面（Step 2），包含节点和关系列表
5. 点击"确认并生成图谱" → 跳转到草稿编辑页
6. 在草稿编辑页确认 → 跳转到聚类提案页
7. 确认聚类提案中直接复用了 Step 1 的 topic_tags（不需要额外生成）

**Step 5: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: end-to-end verification adjustments"
```
