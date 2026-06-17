# 图谱质量评估实验室实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现一个评估实验室，用信息重建法 A/B 对比不同抽取策略的图谱质量。

**Architecture:** 新增 `GraphEvaluator`（评估核心）+ `EvaluationService`（编排层）+ API 端点 + 前端页面。GraphExtractor 的 `run_skeleton/run_expand` 增加可配置参数（temperature、extra_instruction）以支持策略档位。评估流程：原文→ground truth 知识点（一次），每个策略→抽取→图谱→重建知识点→对比评分。

**Tech Stack:** FastAPI + httpx + React + TypeScript

---

### Task 1: LLMClient.generate_json 添加 temperature 参数

**Files:**
- Modify: `backend/app/core/llm_client.py:101-134`

**Step 1: 修改 generate_json 签名和实现**

将第 101 行的方法签名改为：

```python
    async def generate_json(
        self,
        prompt: str = "",
        system: str = "",
        system_prompt: str = "",
        user_prompt: str = "",
        temperature: float = 0.3,
        retries: int = 2,
    ) -> dict:
        """Generate and parse JSON response from LLM."""
        # Support both calling conventions
        p = user_prompt or prompt
        s = system_prompt or system
        raw = await self.generate(p, system=s, temperature=temperature)
```

同时在第 129 行的 retry 调用中也传入 temperature：

```python
                    raw = await self.generate(
                        f"上一次输出不是合法 JSON，请重新输出。错误信息：{e}\n\n原始输出：\n{raw}",
                        system=system,
                        temperature=temperature,
                    )
```

**Step 2: 验证语法**

Run: `cd backend && python -c "import ast; ast.parse(open('app/core/llm_client.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/core/llm_client.py
git commit -m "feat: generate_json 支持 temperature 参数"
```

---

### Task 2: GraphExtractor 添加策略参数

**Files:**
- Modify: `backend/app/core/graph_extractor.py:492-533`

**Step 1: 修改 run_skeleton 签名和实现**

将第 492 行的方法改为：

```python
    async def run_skeleton(
        self, title: str, content: str,
        temperature: float = 0.3,
        extra_instruction: str = "",
    ) -> dict:
        """Step 1: Extract article-level skeleton (summary, topic_tags, core_claims)."""
        logger.info("Skeleton: Extracting article-level skeleton")
        article_prompt = f"文章标题：{title}\n\n文章内容：\n{content}"

        system = _SKELETON_SYSTEM
        if extra_instruction:
            system = system + "\n\n额外要求：\n" + extra_instruction

        raw = await self._llm.generate_json(
            system_prompt=system, user_prompt=article_prompt,
            temperature=temperature,
        )
```

**Step 2: 修改 run_expand 签名和实现**

将第 514 行的方法改为：

```python
    async def run_expand(
        self, title: str, content: str, skeleton: dict,
        temperature: float = 0.3,
        extra_instruction: str = "",
    ) -> dict:
        """Step 2: Expand skeleton into full knowledge graph (nodes + edges)."""
        logger.info("Expand: Expanding skeleton into full graph")
        expand_prompt = _build_expand_prompt(title, content, skeleton)

        system = _EXPAND_SYSTEM
        if extra_instruction:
            system = system + "\n\n额外要求：\n" + extra_instruction

        raw = await self._llm.generate_json(
            system_prompt=system, user_prompt=expand_prompt,
            temperature=temperature,
        )
```

**Step 3: 验证语法**

Run: `cd backend && python -c "import ast; ast.parse(open('app/core/graph_extractor.py').read()); print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/core/graph_extractor.py
git commit -m "feat: GraphExtractor 支持策略参数 (temperature + extra_instruction)"
```

---

### Task 3: GraphEvaluator 评估核心

**Files:**
- Create: `backend/app/core/graph_evaluator.py`

**Step 1: 创建文件**

```python
"""Graph quality evaluator using information reconstruction method."""

import json
import logging
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

_GT_SYSTEM = (
    "你是知识评估专家。\n\n"
    "请从以下文章中提取最重要的知识点列表（5-10个）。\n"
    "每个知识点用一句话概括，要具体、可验证。\n\n"
    "输出严格 JSON：\n"
    '{"knowledge_points": ["知识点1", "知识点2", ...]}'
)

_RECONSTRUCT_SYSTEM = (
    "你是知识图谱阅读者。\n\n"
    "以下是一个知识图谱的 JSON 数据。\n"
    "请仅根据图谱中的信息（不要猜测、不要补充外部知识），"
    "列出你能从这个图谱中领会的知识点。\n"
    "每个知识点用一句话概括。\n\n"
    "输出严格 JSON：\n"
    '{"knowledge_points": ["知识点1", "知识点2", ...]}'
)

_COMPARE_SYSTEM = (
    "你是评分员。\n\n"
    "请对比两组知识点：\n"
    "- Ground Truth（从原文提取）\n"
    "- 重建（从图谱推断）\n\n"
    "请判断每个 ground truth 知识点是否在重建列表中有对应的匹配项（语义等价即可，不要求字面相同）。\n"
    "同时标记重建列表中多出来的知识点（hallucinated）。\n\n"
    "输出严格 JSON：\n"
    "{\n"
    '  "matched": [{"gt": "原文知识点", "reconstructed": "图谱中对应知识点"}],\n'
    '  "missed": ["未在图谱中恢复的原有知识点"],\n'
    '  "hallucinated": ["图谱中重建出但原文没有的知识点"],\n'
    '  "recall": 0.0,\n'
    '  "precision": 0.0\n'
    "}\n\n"
    "recall = len(matched) / len(ground_truth)\n"
    "precision = len(matched) / len(reconstructed)"
)

_MAX_CONTENT_LEN = 8000


class GraphEvaluator:
    """使用信息重建法评估图谱质量。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def extract_ground_truth(self, title: str, content: str) -> list[str]:
        """从原文提取 ground truth 知识点。"""
        truncated = content[:_MAX_CONTENT_LEN]
        prompt = f"文章标题：{title}\n\n文章内容：\n{truncated}"

        try:
            raw = await self.llm.generate_json(
                system_prompt=_GT_SYSTEM, user_prompt=prompt, temperature=0.2,
            )
            return raw.get("knowledge_points", [])
        except Exception as e:
            logger.error(f"Ground truth extraction failed: {e}")
            return []

    async def reconstruct_from_graph(self, graph_json: dict) -> list[str]:
        """让 LLM 只看图谱，重建知识点。"""
        graph_summary = self._summarize_graph(graph_json)
        prompt = f"图谱数据：\n{graph_summary}"

        try:
            raw = await self.llm.generate_json(
                system_prompt=_RECONSTRUCT_SYSTEM, user_prompt=prompt, temperature=0.2,
            )
            return raw.get("knowledge_points", [])
        except Exception as e:
            logger.error(f"Graph reconstruction failed: {e}")
            return []

    async def compare_and_score(
        self, ground_truth: list[str], reconstructed: list[str],
    ) -> dict[str, Any]:
        """对比两组知识点，返回评分。"""
        prompt = json.dumps({
            "ground_truth": ground_truth,
            "reconstructed": reconstructed,
        }, ensure_ascii=False, indent=2)

        try:
            raw = await self.llm.generate_json(
                system_prompt=_COMPARE_SYSTEM, user_prompt=prompt, temperature=0.1,
            )
            recall = float(raw.get("recall", 0.0))
            precision = float(raw.get("precision", 0.0))
            f1 = (2 * recall * precision / (recall + precision)) if (recall + precision) > 0 else 0.0
            return {
                "matched": raw.get("matched", []),
                "missed": raw.get("missed", []),
                "hallucinated": raw.get("hallucinated", []),
                "recall": round(recall, 4),
                "precision": round(precision, 4),
                "f1": round(f1, 4),
            }
        except Exception as e:
            logger.error(f"Compare and score failed: {e}")
            return {
                "matched": [], "missed": list(ground_truth),
                "hallucinated": list(reconstructed),
                "recall": 0.0, "precision": 0.0, "f1": 0.0,
            }

    def compute_structure_metrics(self, graph_json: dict) -> dict:
        """计算图谱结构指标。"""
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        node_ids = {n.get("temp_id") or n.get("id") for n in nodes}
        connected = set()
        for e in edges:
            connected.add(e.get("source"))
            connected.add(e.get("target"))

        isolated = node_ids - connected

        with_evidence = sum(1 for e in edges if e.get("evidence", "").strip())

        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "isolated_nodes": len(isolated),
            "evidence_coverage": round(with_evidence / len(edges), 4) if edges else 0.0,
        }

    @staticmethod
    def _summarize_graph(graph_json: dict) -> str:
        """将图谱压缩为 LLM 可读的文本摘要。"""
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        lines = [f"摘要: {graph_json.get('summary', '无')}", "", "节点:"]

        for n in nodes:
            nt = n.get("node_type", "?")
            name = n.get("name", "?")
            desc = n.get("description", "")
            lines.append(f"  [{nt}] {name}: {desc}")

        lines.append("")
        lines.append("关系:")

        for e in edges:
            src = e.get("source", "?")
            tgt = e.get("target", "?")
            rel = e.get("relation_type", "?")
            ev = e.get("evidence", "")
            lines.append(f"  {src} --[{rel}]--> {tgt}  证据: {ev}")

        return "\n".join(lines)
```

**Step 2: 验证语法**

Run: `cd backend && python -c "import ast; ast.parse(open('app/core/graph_evaluator.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/core/graph_evaluator.py
git commit -m "feat: GraphEvaluator 信息重建法评估核心"
```

---

### Task 4: EvaluationService 编排层

**Files:**
- Create: `backend/app/services/evaluation_service.py`

**Step 1: 创建文件**

```python
"""Evaluation orchestration service."""

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.llm_client import LLMClient
from ..core.graph_extractor import GraphExtractor, _validate_and_sanitize, _calibrate_confidence
from ..core.graph_evaluator import GraphEvaluator
from ..models.db_models import Document

logger = logging.getLogger(__name__)

# 策略档位预设
STRATEGIES: dict[str, dict[str, Any]] = {
    "concise": {
        "label": "简洁",
        "temperature": 0.1,
        "extra_instruction": "只提取文章最核心的主题和主张，忽略次要实体。目标 5-8 个节点。",
    },
    "standard": {
        "label": "标准",
        "temperature": 0.3,
        "extra_instruction": "",
    },
    "detailed": {
        "label": "详细",
        "temperature": 0.6,
        "extra_instruction": "尽可能详细展开，包括次要概念、具体工具和方法。目标 15-25 个节点。",
    },
}


class EvaluationService:
    """编排图谱评估流程。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.extractor = GraphExtractor(self.llm)
        self.evaluator = GraphEvaluator(self.llm)

    async def run_evaluation(
        self, document_id: str, strategies: list[str],
    ) -> dict[str, Any]:
        """运行完整评估流程。"""
        # 1. 获取原文
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return {"error": "Document not found"}

        title = doc.title
        content = doc.cleaned_content or doc.raw_content

        # 2. 提取 ground truth（只做一次）
        ground_truth = await self.evaluator.extract_ground_truth(title, content)

        # 3. 对每个策略运行评估
        results = []
        for strategy_key in strategies:
            strategy = STRATEGIES.get(strategy_key)
            if not strategy:
                continue
            try:
                item = await self._evaluate_strategy(
                    title, content, strategy_key, strategy, ground_truth,
                )
                results.append(item)
            except Exception as e:
                logger.error(f"Strategy '{strategy_key}' evaluation failed: {e}")
                results.append({
                    "strategy": strategy_key,
                    "label": strategy.get("label", strategy_key),
                    "error": str(e),
                })

        return {
            "document_title": title,
            "ground_truth": ground_truth,
            "results": results,
        }

    async def _evaluate_strategy(
        self,
        title: str,
        content: str,
        strategy_key: str,
        strategy: dict,
        ground_truth: list[str],
    ) -> dict[str, Any]:
        """评估单个策略。"""
        temp = strategy["temperature"]
        extra = strategy["extra_instruction"]

        # 抽取
        skeleton = await self.extractor.run_skeleton(
            title, content, temperature=temp, extra_instruction=extra,
        )
        expanded = await self.extractor.run_expand(
            title, content, skeleton, temperature=temp, extra_instruction=extra,
        )

        # 校验清洗（复用现有逻辑）
        nodes = expanded.get("nodes", [])
        edges = expanded.get("edges", [])
        edges = _calibrate_confidence(edges, content)
        graph_json = _validate_and_sanitize({
            "summary": skeleton.get("summary", ""),
            "nodes": nodes,
            "edges": edges,
        })

        # 重建知识点
        reconstructed = await self.evaluator.reconstruct_from_graph(graph_json)

        # 对比评分
        scores = await self.evaluator.compare_and_score(ground_truth, reconstructed)

        # 结构指标
        structure = self.evaluator.compute_structure_metrics(graph_json)

        return {
            "strategy": strategy_key,
            "label": strategy["label"],
            "graph": graph_json,
            "reconstructed": reconstructed,
            "scores": {
                **scores,
                **structure,
            },
        }
```

**Step 2: 验证语法**

Run: `cd backend && python -c "import ast; ast.parse(open('app/services/evaluation_service.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/evaluation_service.py
git commit -m "feat: EvaluationService 评估编排层"
```

---

### Task 5: API 端点 + 路由注册

**Files:**
- Create: `backend/app/api/evaluation.py`
- Modify: `backend/app/main.py:4,28`
- Modify: `backend/app/models/schemas.py` (add request model)

**Step 1: 在 schemas.py 添加请求模型**

在 `PartitionSplitRequest` 之后添加：

```python
class EvaluationRunRequest(BaseModel):
    document_id: str
    strategies: list[str] = ["concise", "standard", "detailed"]
```

**Step 2: 创建 evaluation.py**

```python
"""API routes for graph evaluation."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.schemas import EvaluationRunRequest
from ..services.evaluation_service import EvaluationService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/evaluation/run")
async def run_evaluation(
    data: EvaluationRunRequest,
    db: AsyncSession = Depends(get_db),
):
    """运行图谱质量评估。"""
    service = EvaluationService(db)
    try:
        result = await service.run_evaluation(data.document_id, data.strategies)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        raise HTTPException(status_code=500, detail="评估失败")
```

**Step 3: 注册路由（main.py）**

第 4 行 import 改为：
```python
from .api import documents, draft_graphs, insertion, graph, search, qa, extraction, clustering, partitions, evaluation
```

第 28 行后添加：
```python
app.include_router(evaluation.router, prefix="/api", tags=["evaluation"])
```

**Step 4: 验证全部语法**

Run: `cd backend && python -c "
import ast
for f in ['app/api/evaluation.py', 'app/models/schemas.py', 'app/main.py']:
    ast.parse(open(f).read())
    print(f'{f} OK')
"`
Expected: 三个 OK

**Step 5: Commit**

```bash
git add backend/app/api/evaluation.py backend/app/models/schemas.py backend/app/main.py
git commit -m "feat: 评估 API 端点 + 路由注册"
```

---

### Task 6: 前端 API client

**Files:**
- Modify: `frontend/src/api/client.ts`

**Step 1: 在文件末尾添加评估 API 函数**

```typescript
// ── Evaluation ──

export async function runEvaluation(documentId: string, strategies: string[] = ['concise', 'standard', 'detailed']) {
  const res = await api.post('/evaluation/run', { document_id: documentId, strategies });
  return res.data;
}
```

**Step 2: 验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 零输出（通过）

**Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: 前端评估 API 函数"
```

---

### Task 7: 前端评估实验室页面

**Files:**
- Create: `frontend/src/pages/EvaluationLabPage.tsx`
- Modify: `frontend/src/App.tsx` (路由 + 导航)

**Step 1: 创建 EvaluationLabPage.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { getDocuments, runEvaluation } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';

type StrategyResult = {
  strategy: string;
  label: string;
  error?: string;
  graph?: { summary?: string; nodes: any[]; edges: any[] };
  reconstructed?: string[];
  scores?: {
    recall: number;
    precision: number;
    f1: number;
    node_count: number;
    edge_count: number;
    isolated_nodes: number;
    evidence_coverage: number;
    matched?: any[];
    missed?: string[];
    hallucinated?: string[];
  };
};

type EvalResponse = {
  document_title: string;
  ground_truth: string[];
  results: StrategyResult[];
};

const STRATEGY_LABELS: Record<string, string> = {
  concise: '简洁',
  standard: '标准',
  detailed: '详细',
};

function scoreColor(score: number): string {
  if (score >= 0.85) return '#16a34a';
  if (score >= 0.6) return '#f59e0b';
  return '#dc2626';
}

export default function EvaluationLabPage() {
  const [documents, setDocuments] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState('');
  const [strategies, setStrategies] = useState<string[]>(['concise', 'standard', 'detailed']);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [previewStrategy, setPreviewStrategy] = useState<string | null>(null);

  useEffect(() => {
    getDocuments(0, 50).then((data: any) => {
      setDocuments(data.documents || data || []);
    }).catch(() => {});
  }, []);

  const toggleStrategy = (s: string) => {
    setStrategies(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleRun = async () => {
    if (!selectedDoc || strategies.length === 0) return;
    setRunning(true);
    setResult(null);
    setProgress('正在提取 ground truth 知识点...');
    try {
      const data = await runEvaluation(selectedDoc, strategies);
      setResult(data);
    } catch (e: any) {
      alert('评估失败: ' + (e?.message || '未知错误'));
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const convertGraph = (graph: any) => {
    const nodes: GraphNode[] = (graph?.nodes || []).map((n: any) => ({
      id: n.temp_id || n.id, nodeType: n.node_type, name: n.name, description: n.description,
    }));
    const edges: GraphEdge[] = (graph?.edges || []).map((e: any) => ({
      id: e.temp_id || e.id, source: e.source, target: e.target,
      relationType: e.relation_type, confidence: e.confidence,
    }));
    return { nodes, edges };
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h2 style={{ margin: '0 0 20px 0' }}>图谱评估实验室</h2>

      {/* 配置区 */}
      <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1e293b' }}>选择文章</label>
          <select value={selectedDoc} onChange={e => setSelectedDoc(e.target.value)}
            style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}>
            <option value="">请选择...</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1e293b' }}>策略档位</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['concise', 'standard', 'detailed'].map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={strategies.includes(s)} onChange={() => toggleStrategy(s)} />
                {STRATEGY_LABELS[s]}
              </label>
            ))}
          </div>
        </div>

        <button onClick={handleRun} disabled={running || !selectedDoc || strategies.length === 0}
          style={{
            padding: '10px 24px', background: (running || !selectedDoc || strategies.length === 0) ? '#cbd5e1' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
          }}>
          {running ? '评估中...' : '开始评估'}
        </button>
        {running && <span style={{ marginLeft: 12, fontSize: 13, color: '#64748b' }}>{progress}</span>}
      </div>

      {/* 结果区 */}
      {result && (
        <>
          {/* Ground Truth */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>Ground Truth 知识点 ({result.ground_truth.length})</h3>
            {result.ground_truth.map((kp, i) => (
              <div key={i} style={{ fontSize: 13, color: '#475569', padding: '3px 0', paddingLeft: 12, borderLeft: '2px solid #e2e8f0' }}>
                {kp}
              </div>
            ))}
          </div>

          {/* 评分对比表 */}
          {result.results.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>评分对比</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>指标</th>
                    {result.results.map(r => (
                      <th key={r.strategy} style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '2px solid #e2e8f0' }}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'recall', label: '召回率', format: (v: number) => `${(v * 100).toFixed(0)}%` },
                    { key: 'precision', label: '准确率', format: (v: number) => `${(v * 100).toFixed(0)}%` },
                    { key: 'f1', label: 'F1', format: (v: number) => `${(v * 100).toFixed(0)}%` },
                    { key: 'node_count', label: '节点数', format: (v: number) => String(v) },
                    { key: 'edge_count', label: '边数', format: (v: number) => String(v) },
                    { key: 'isolated_nodes', label: '孤立节点', format: (v: number) => String(v) },
                    { key: 'evidence_coverage', label: '证据覆盖', format: (v: number) => `${(v * 100).toFixed(0)}%` },
                  ].map(row => (
                    <tr key={row.key}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 500 }}>{row.label}</td>
                      {result.results.map(r => {
                        const val = r.scores?.[row.key as keyof typeof r.scores] as number;
                        const isScore = ['recall', 'precision', 'f1'].includes(row.key);
                        return (
                          <td key={r.strategy} style={{
                            padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e2e8f0',
                            color: isScore && typeof val === 'number' ? scoreColor(val) : '#1e293b',
                            fontWeight: isScore ? 600 : 400,
                          }}>
                            {r.error ? '—' : (typeof val === 'number' ? row.format(val) : '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 差异详情 */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>差异详情</h3>
            {result.results.map(r => (
              <div key={r.strategy} style={{ marginBottom: 8, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setExpandedDetail(expandedDetail === r.strategy ? null : r.strategy)}
                  style={{ width: '100%', padding: '10px 14px', background: '#f8fafc', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                  {r.label} {expandedDetail === r.strategy ? '▼' : '▶'}
                </button>
                {expandedDetail === r.strategy && (
                  <div style={{ padding: 12 }}>
                    {r.scores?.missed && r.scores.missed.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>丢失的知识点 ({r.scores.missed.length})</div>
                        {r.scores.missed.map((m, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#dc2626', padding: '2px 0', paddingLeft: 12 }}>• {m}</div>
                        ))}
                      </div>
                    )}
                    {r.scores?.hallucinated && r.scores.hallucinated.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>编造的知识点 ({r.scores.hallucinated.length})</div>
                        {r.scores.hallucinated.map((h, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#f59e0b', padding: '2px 0', paddingLeft: 12 }}>• {h}</div>
                        ))}
                      </div>
                    )}
                    {!r.scores?.missed?.length && !r.scores?.hallucinated?.length && (
                      <div style={{ fontSize: 12, color: '#16a34a' }}>无差异，完美匹配</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 图谱预览 */}
          <div>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>图谱预览</h3>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {result.results.map(r => (
                <button key={r.strategy} onClick={() => setPreviewStrategy(previewStrategy === r.strategy ? null : r.strategy)}
                  style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: 'none',
                    background: previewStrategy === r.strategy ? '#3b82f6' : '#f1f5f9',
                    color: previewStrategy === r.strategy ? '#fff' : '#64748b',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            {previewStrategy && (() => {
              const r = result.results.find(x => x.strategy === previewStrategy);
              if (!r?.graph) return null;
              return (
                <div style={{ height: 400, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                  <GraphEditor graphData={convertGraph(r.graph)} editable={false} />
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 2: 更新 App.tsx**

在 import 区域添加：
```typescript
import EvaluationLabPage from './pages/EvaluationLabPage';
```

navItems 数组中，在 `{ to: '/merge', label: '合并去重' }` 之后添加：
```typescript
  { to: '/eval', label: '评估' },
```

Routes 中，在 `/merge` 路由之后添加：
```typescript
            <Route path="/eval" element={<EvaluationLabPage />} />
```

**Step 3: 验证 TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: 零输出（通过）

**Step 4: Commit**

```bash
git add frontend/src/pages/EvaluationLabPage.tsx frontend/src/App.tsx
git commit -m "feat: 评估实验室前端页面"
```

---

### Task 8: 最终验证 + 提交

**Step 1: 全部后端语法检查**

Run: `cd backend && python -c "
import ast
for f in ['app/core/llm_client.py', 'app/core/graph_extractor.py', 'app/core/graph_evaluator.py', 'app/services/evaluation_service.py', 'app/api/evaluation.py', 'app/models/schemas.py', 'app/main.py']:
    ast.parse(open(f).read())
    print(f'{f} OK')
"`
Expected: 7 个 OK

**Step 2: 前端类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 零输出

**Step 3: 确认 git 状态**

Run: `git status`
Expected: `nothing to commit, working tree clean`
