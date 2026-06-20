# 命题级知识抽取 Phase 1 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 给现有两阶段抽取新增一个 `proposition`（命题化）模式作为 A/B 实验对照组，默认行为完全不变，验证命题化能否显著提升图谱的信息还原度。

**Architecture:** 沿用 skeleton→expand 两阶段管线。在 `run_expand`/`run_expand_stream` 上新增 `mode` 参数，新增 `_EXPAND_PROPOSITION_SYSTEM` prompt 引导 LLM 为每个 claim 展开成自包含的命题节点。节点类型白名单加 `proposition`/`section`，校验层加 description 长度+parent_claim_id 强约束。评估实验室加第四个档位，复用现有 A/B 基础设施。

**Tech Stack:** FastAPI + httpx + React + TypeScript + @xyflow/react

**前置条件:**
- 设计文档：`docs/plans/2026-06-19-proposition-extraction-design.md`
- 工作目录有未提交的 422 fix（Task 0 处理）
- 后端运行环境已配置 `.env`（DATABASE_URL + LLM_*）

**实施原则：**
- TDD 优先用于纯函数（白名单、校验）。无 pytest 的 LLM 调用代码用 smoke 验证 + 手工 API 测试
- 每个 Task 单独 commit，message 用中文动词开头
- 修改 JSONB 字段后必须 `flag_modified`
- LLM 输出必须经 `_validate_and_sanitize` 清洗
- 不改默认行为：mode 默认仍是 `standard`

---

### Task 0: 提交 422 fix，建立干净基线

**Files:**
- Already modified: `backend/app/models/schemas.py`, `backend/app/api/draft_graphs.py`

**Step 1: 确认改动符合预期**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1 && git diff backend/app/models/schemas.py backend/app/api/draft_graphs.py`
Expected:
- `schemas.py`: `DraftGraphUpdateRequest.graph_json` 类型从 `GraphData` 改为 `dict`
- `draft_graphs.py`: `update_draft_graph` 删除 `.model_dump()` 调用

**Step 2: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('app/models/schemas.py').read()); ast.parse(open('app/api/draft_graphs.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1
git add backend/app/models/schemas.py backend/app/api/draft_graphs.py
git commit -m "fix: DraftGraphUpdateRequest 改为 dict 透传，修复 422"
```

---

### Task 1: 节点类型白名单新增 proposition 和 section

**Files:**
- Modify: `backend/app/core/graph_extractor.py:27-31`（VALID_NODE_TYPES）
- Modify: `backend/app/models/schemas.py:10-14`（NODE_TYPES）
- Modify: `backend/app/models/db_models.py`（如果 Node 表有 node_type CHECK 约束）

**Step 1: 检查 db_models 是否有约束**

Run: `grep -n "node_type" /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend/app/models/db_models.py | head -20`

如果有 CHECK 约束枚举，需要同步加。如果没有（通常 SQLAlchemy 不用 CHECK），跳过。

**Step 2: 修改 graph_extractor.py**

把 `VALID_NODE_TYPES` 改为：

```python
VALID_NODE_TYPES = frozenset({
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology", "question",
    "partition",
    "proposition",  # 自包含原子事实（Dense X Retrieval）
    "section",      # 章节分组容器（弱化使用，仅多级章节文章）
})
```

**Step 3: 修改 schemas.py**

把 `NODE_TYPES` 改为：

```python
NODE_TYPES = [
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology", "question", "chunk",
    "partition",
    "proposition", "section",
]
```

**Step 4: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.core.graph_extractor import VALID_NODE_TYPES; assert 'proposition' in VALID_NODE_TYPES and 'section' in VALID_NODE_TYPES; print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add backend/app/core/graph_extractor.py backend/app/models/schemas.py
git commit -m "feat: 节点类型白名单新增 proposition 和 section"
```

---

### Task 2: 新增 ExtractionMode 枚举

**Files:**
- Modify: `backend/app/models/schemas.py`（顶部新增）

**Step 1: 新增枚举**

在 `schemas.py` 顶部 `NODE_TYPES` 定义之前，加：

```python
from enum import Enum


class ExtractionMode(str, Enum):
    """抽取模式：standard 为当前默认，proposition 为命题化实验模式。"""
    STANDARD = "standard"
    PROPOSITION = "proposition"
```

**Step 2: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.models.schemas import ExtractionMode; assert ExtractionMode.STANDARD.value == 'standard'; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/models/schemas.py
git commit -m "feat: 新增 ExtractionMode 枚举"
```

---

### Task 3: 新增 _EXPAND_PROPOSITION_SYSTEM prompt 和 few-shot

**Files:**
- Modify: `backend/app/core/graph_extractor.py`（在 `_EXPAND_SYSTEM` 后追加）

**Step 1: 加 few-shot 输出示例**

在 `_FEWSHOT_EXPAND_OUTPUT` 定义之后（约 162 行后），插入：

```python
_FEWSHOT_PROPOSITION_OUTPUT = json.dumps({
    "nodes": [
        {"temp_id": "n1", "node_type": "article", "name": "GraphRAG：基于知识图谱的检索增强生成", "description": "文章整体节点"},
        {"temp_id": "n2", "node_type": "topic", "name": "检索增强生成", "description": "文章核心主题"},
        {"temp_id": "n3", "node_type": "claim", "name": "GraphRAG 在全局理解任务上优于传统 RAG", "description": "GraphRAG 在需要全局理解的数据集上显著优于传统 RAG"},
        {"temp_id": "p1", "node_type": "proposition", "name": "GraphRAG 在需要全局理解的数据集上显著优于传统 RAG",
         "description": "GraphRAG 在需要跨文档推理或全局理解的数据集（如 MultiHop-RAG）上显著优于传统 RAG 方法，能生成更全面的回答（论文实验部分）",
         "parent_claim_id": "n3",
         "metadata": {"data_points": ["显著优于"], "conditions": ["全局理解任务"], "citations": ["实验部分"]}},
        {"temp_id": "p2", "node_type": "proposition", "name": "传统 RAG 在跨文档推理时表现不佳",
         "description": "传统 RAG 系统通过向量相似度检索文档片段，在需要跨文档推理或全局理解时存在局限，无法整合多文档信息",
         "parent_claim_id": "n3"},
        {"temp_id": "p3", "node_type": "proposition", "name": "GraphRAG 在 MultiHop-RAG 上 F1=0.73",
         "description": "在 MultiHop-RAG 数据集（含 2023 年新闻的多跳推理问题）上，GraphRAG 的 F1 达到 0.73，比传统 RAG 高 15 个百分点（论文表3）",
         "parent_claim_id": "n3",
         "metadata": {"data_points": ["F1=0.73", "+15pp"], "conditions": ["MultiHop-RAG dataset"], "citations": ["表3"]}}
    ],
    "edges": [
        {"temp_id": "e1", "source": "n1", "target": "n2", "relation_type": "tag", "confidence": 0.95, "evidence": "文章围绕检索增强生成展开"},
        {"temp_id": "e2", "source": "n1", "target": "n3", "relation_type": "contains", "confidence": 1.0, "evidence": "文章核心观点"},
        {"temp_id": "e3", "source": "p1", "target": "n3", "relation_type": "evidence_for", "confidence": 0.9, "evidence": "GraphRAG 在需要全局理解的数据集上显著优于传统 RAG"},
        {"temp_id": "e4", "source": "p2", "target": "n3", "relation_type": "supports", "confidence": 0.85, "evidence": "传统 RAG 在跨文档推理时表现不佳"},
        {"temp_id": "e5", "source": "p3", "target": "n3", "relation_type": "evidence_for", "confidence": 0.95, "evidence": "MultiHop-RAG 上 F1=0.73"}
    ]
}, ensure_ascii=False, indent=2)
```

**Step 2: 加 system prompt**

在 `_EXPAND_SYSTEM` 定义之后（约 217 行后），插入：

```python
_EXPAND_PROPOSITION_SYSTEM = (
    "你是一个命题化知识图谱展开模块。基于文章骨架，将每个 claim 节点展开为 3-7 个自包含的命题节点（proposition）。\n\n"
    "命题三性要求（严格遵守）：\n"
    "1. unique（唯一）：每个命题含义唯一，不与其他命题重叠\n"
    "2. atomic（原子）：不可再分为更小的独立事实\n"
    "3. self-contained（自包含）：包含所有必要上下文（数据、条件、引用、主语）\n\n"
    "正例（自包含）：「在 MultiHop-RAG 数据集上，GraphRAG 的 F1=0.73，比传统 RAG 高 15 个百分点（论文表3）」\n"
    "反例（标签化）：「GraphRAG F1 很高」（缺数据集和具体值）\n\n"
    "展开规则：\n"
    "1. 保留骨架中的 article、topic、claim 节点\n"
    "2. 围绕每个 claim 节点展开 3-7 个 proposition 节点，capture 该 claim 的所有细节、数据、对比、条件\n"
    "3. 每个 proposition 必须有 parent_claim_id 指向所属 claim 的 temp_id\n"
    "4. proposition 的 description 必须是完整的自包含事实陈述，≥30 字\n"
    "5. 如果原文有具体数据，必须包含在 description 和 metadata.data_points 中\n"
    "6. 通过以下关系连接：\n"
    "   - proposition → claim: 用 evidence_for（提供证据）或 supports/contradicts（表明立场）\n"
    "   - article → topic: tag\n"
    "   - article → claim: contains\n"
    "   - proposition ↔ proposition: causes/derived_from/compares_with（还原推理链）\n"
    "7. 每条边必须有 evidence，尽量引用原文\n"
    "8. 单个 claim 下的 proposition 数量不超过 7 个\n\n"
    + _RELATION_GUIDANCE +
    "\n节点类型只能使用：\n"
    "article, concept, claim, topic, person, organization, paper, project, "
    "framework, tool, method, technology, question, proposition, section\n\n"
    "输出 JSON 格式：\n"
    "{\n"
    '  "nodes": [\n'
    '    {"temp_id": "n1", "node_type": "类型", "name": "名称", "description": "描述",\n'
    '     "parent_claim_id": "n3", "metadata": {"data_points": [...], "conditions": [...], "citations": [...]}}\n'
    "  ],\n"
    '  "edges": [\n'
    '    {"temp_id": "e1", "source": "n1", "target": "n2", "relation_type": "关系类型", "confidence": 0.9, "evidence": "原文证据"}\n'
    "  ]\n"
    "}\n\n"
    "示例：\n"
    f"输出：{_FEWSHOT_PROPOSITION_OUTPUT}"
)
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.core.graph_extractor import _EXPAND_PROPOSITION_SYSTEM; assert '命题三性' in _EXPAND_PROPOSITION_SYSTEM; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/core/graph_extractor.py
git commit -m "feat: 新增命题化 expand prompt 和 few-shot 示例"
```

---

### Task 4: GraphExtractor.run_expand 增加 mode 参数

**Files:**
- Modify: `backend/app/core/graph_extractor.py:525-555`（run_expand）、`557-596`（run_expand_stream）

**Step 1: 修改 run_expand 签名和 system 选择**

把当前 `run_expand` 改为：

```python
    async def run_expand(
        self, title: str, content: str, skeleton: dict,
        temperature: float = 0.3,
        extra_instruction: str = "",
        mode: str = "standard",
    ) -> dict:
        """Step 2: Expand skeleton into full knowledge graph (nodes + edges).

        mode:
          - "standard": 现状（topic + claim + 实体节点）
          - "proposition": 命题化（claim 节点下展开 3-7 个自包含命题节点）
        """
        logger.info("Expand (mode=%s): Expanding skeleton into full graph", mode)
        expand_prompt = _build_expand_prompt(title, content, skeleton)

        if mode == "proposition":
            system = _EXPAND_PROPOSITION_SYSTEM
        else:
            system = _EXPAND_SYSTEM
        if extra_instruction:
            system = system + "\n\n额外要求：\n" + extra_instruction

        raw = await self._llm.generate_json(
            system_prompt=system, user_prompt=expand_prompt,
            temperature=temperature,
        )
        expanded = _parse_json_response(raw)
        if not expanded:
            logger.warning("Expand step returned invalid response, using defaults")
            expanded = {}

        expanded.setdefault("nodes", [])
        expanded.setdefault("edges", [])

        logger.info(
            "Expand complete: %d nodes, %d edges",
            len(expanded["nodes"]),
            len(expanded["edges"]),
        )
        return expanded
```

**Step 2: 修改 run_expand_stream 签名和 system 选择**

把当前 `run_expand_stream` 改为：

```python
    async def run_expand_stream(
        self, title: str, content: str, skeleton: dict,
        mode: str = "standard",
    ) -> AsyncGenerator[tuple[str, str], None]:
        """Stream expand step, yielding (event, data) tuples.

        Events:
          - ("chunk", text)  — incremental LLM output
          - ("done", json)   — final parsed result
          - ("error", msg)   — on failure
        """
        logger.info("Expand (stream, mode=%s): Expanding skeleton into full graph", mode)
        expand_prompt = _build_expand_prompt(title, content, skeleton)

        system = _EXPAND_PROPOSITION_SYSTEM if mode == "proposition" else _EXPAND_SYSTEM

        accumulated: list[str] = []
        try:
            async for delta in self._llm.generate_stream(
                prompt=expand_prompt, system=system
            ):
                accumulated.append(delta)
                yield ("chunk", delta)
        except Exception as exc:
            logger.exception("Expand stream failed")
            yield ("error", str(exc))
            return

        raw_text = "".join(accumulated)
        parsed = _parse_json_response(raw_text)
        if not parsed:
            yield ("error", "Failed to parse LLM output as JSON")
            return

        parsed.setdefault("nodes", [])
        parsed.setdefault("edges", [])

        logger.info(
            "Expand (stream) complete: %d nodes, %d edges",
            len(parsed["nodes"]),
            len(parsed["edges"]),
        )
        yield ("done", parsed)
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('app/core/graph_extractor.py').read()); print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/core/graph_extractor.py
git commit -m "feat: run_expand 和 run_expand_stream 支持 mode 参数"
```

---

### Task 5: 命题节点校验规则（description 长度 + parent_claim_id）

**Files:**
- Modify: `backend/app/core/graph_extractor.py:307-416`（_validate_and_sanitize）

**Step 1: 修改节点清洗逻辑**

在 `_validate_and_sanitize` 中，找到节点循环（约 330 行 `for idx, node in enumerate(raw_nodes):`）。替换为以下逻辑（增加 proposition 特殊处理）：

```python
    parent_claim_ids: set[str] = set()  # 用于校验 proposition 的 parent_claim_id
    proposition_counts: dict[str, int] = {}  # 每个 claim 下的 proposition 计数

    for idx, node in enumerate(raw_nodes):
        if not isinstance(node, dict):
            errors.append(f"nodes[{idx}] is not a dict, skipped")
            continue

        missing = REQUIRED_NODE_FIELDS - set(node.keys())
        if missing:
            errors.append(f"nodes[{idx}] missing fields: {missing}")
            continue

        node_type = node["node_type"]
        if node_type not in VALID_NODE_TYPES:
            errors.append(f"nodes[{idx}] has invalid node_type '{node_type}', skipped")
            continue

        temp_id = str(node["temp_id"])
        valid_temp_ids.add(temp_id)

        clean_node: dict[str, Any] = {
            "temp_id": temp_id,
            "node_type": node_type,
            "name": str(node["name"]),
            "description": str(node["description"]),
        }

        # ── Proposition 特殊校验 ──
        if node_type == "proposition":
            desc = clean_node["description"]
            if len(desc) < 30:
                errors.append(
                    f"nodes[{idx}] proposition.description 长度 <30（标签化），skipped"
                )
                continue

            parent = str(node.get("parent_claim_id", "")).strip()
            if not parent:
                # prompt 明确要求 parent_claim_id（"必须"），缺失则丢弃该命题
                errors.append(
                    f"nodes[{idx}] proposition 缺少 parent_claim_id，skipped"
                )
                continue
            parent_claim_ids.add(parent)
            proposition_counts[parent] = proposition_counts.get(parent, 0) + 1
            if proposition_counts[parent] > 7:
                errors.append(
                    f"nodes[{idx}] claim '{parent}' 下 proposition 已达 7 个上限，skipped"
                )
                continue
            clean_node["parent_claim_id"] = parent

            # 透传 metadata（data_points/conditions/citations）
            if isinstance(node.get("metadata"), dict):
                clean_node["metadata"] = node["metadata"]

        # ── Section 特殊处理（弱化：不强制 claims 字段，但允许）──
        if node_type == "section" and isinstance(node.get("claims"), list):
            clean_node["claims"] = node["claims"]

        clean_nodes.append(clean_node)
```

**Step 2: 修改边校验逻辑，确认 parent_claim_id 引用有效**

在边校验之后（约 408 行后），加：

```python
    # 检查 proposition 的 parent_claim_id 是否指向有效 claim 节点
    claim_temp_ids = {
        n["temp_id"] for n in clean_nodes if n["node_type"] == "claim"
    }
    for parent in parent_claim_ids:
        if parent not in claim_temp_ids:
            errors.append(
                f"proposition.parent_claim_id '{parent}' 未在 claim 节点中找到"
            )
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('app/core/graph_extractor.py').read()); print('OK')"`
Expected: `OK`

**Step 4: 单元测试 - 命题校验**

Run:
```bash
cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "
from app.core.graph_extractor import _validate_and_sanitize

# 测试：description 太短的 proposition 被丢弃
result = _validate_and_sanitize({
    'summary': '',
    'nodes': [
        {'temp_id': 'c1', 'node_type': 'claim', 'name': 'claim1', 'description': 'a claim'},
        {'temp_id': 'p1', 'node_type': 'proposition', 'name': 'short', 'description': 'too short', 'parent_claim_id': 'c1'},
    ],
    'edges': [],
})
assert len(result['nodes']) == 1, f'Expected 1 node (short prop dropped), got {len(result[\"nodes\"])}'
assert result['nodes'][0]['temp_id'] == 'c1'
print('Test 1 passed: short proposition dropped')

# 测试：合格的 proposition 被保留
result = _validate_and_sanitize({
    'summary': '',
    'nodes': [
        {'temp_id': 'c1', 'node_type': 'claim', 'name': 'claim1', 'description': 'a claim'},
        {'temp_id': 'p1', 'node_type': 'proposition', 'name': 'valid prop',
         'description': 'This is a valid self-contained proposition with enough detail to pass the length check.',
         'parent_claim_id': 'c1',
         'metadata': {'data_points': ['x=1']}},
    ],
    'edges': [
        {'temp_id': 'e1', 'source': 'p1', 'target': 'c1', 'relation_type': 'evidence_for', 'confidence': 0.9, 'evidence': '原文'},
    ],
})
assert len(result['nodes']) == 2, f'Expected 2 nodes, got {len(result[\"nodes\"])}'
assert result['nodes'][1]['parent_claim_id'] == 'c1'
assert result['nodes'][1]['metadata'] == {'data_points': ['x=1']}
print('Test 2 passed: valid proposition kept with metadata')
print('All tests OK')
"
```
Expected:
```
Test 1 passed: short proposition dropped
Test 2 passed: valid proposition kept with metadata
All tests OK
```

**Step 5: Commit**

```bash
git add backend/app/core/graph_extractor.py
git commit -m "feat: proposition 节点校验规则（description 长度+parent_claim_id+计数上限）"
```

---

### Task 6: ExtractionService.run_step2 和 run_step2_stream 接收 mode

**Files:**
- Modify: `backend/app/services/extraction_service.py:103-151`

**Step 1: 修改 run_step2**

```python
    async def run_step2(self, document_id: str, mode: str = "standard") -> dict:
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            return {"error": "Document not found"}
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "skeleton" not in session.get("graph_json", {}):
            return {"error": "Step 1 not completed. Run step1 first."}

        skeleton = session["graph_json"]["skeleton"]
        result = await self.extractor.run_expand(title, content, skeleton, mode=mode)

        dg_id = await self._save_expanded(session["id"], result)
        return {"session_id": dg_id, "step": 2, "mode": mode, "data": result}
```

**Step 2: 修改 run_step2_stream**

```python
    async def run_step2_stream(
        self, document_id: str, mode: str = "standard"
    ) -> AsyncGenerator[tuple[str, object], None]:
        """Stream step2 expand, yielding (event, payload) tuples.

        Events: "chunk" (str text), "done" (result dict), "error" (str msg).
        Persists the expanded graph to DraftGraph on completion.
        """
        content_tuple = await self._get_doc_content(document_id)
        if not content_tuple:
            yield ("error", "Document not found")
            return
        title, content = content_tuple

        session = await self._get_or_create_session(document_id)
        if not session or "skeleton" not in session.get("graph_json", {}):
            yield ("error", "Step 1 not completed")
            return
        skeleton = session["graph_json"]["skeleton"]
        session_id = session["id"]

        async for event, data in self.extractor.run_expand_stream(
            title, content, skeleton, mode=mode
        ):
            if event == "done":
                try:
                    dg_id = await self._save_expanded(session_id, data)
                    yield ("done", {"session_id": dg_id, "step": 2, "mode": mode, "data": data})
                except Exception as exc:
                    await self.db.rollback()
                    yield ("error", str(exc))
            else:
                yield (event, data)
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('app/services/extraction_service.py').read()); print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/services/extraction_service.py
git commit -m "feat: ExtractionService.run_step2 和 stream 支持 mode 参数"
```

---

### Task 7: API 端点接收 mode 查询参数

**Files:**
- Modify: `backend/app/api/extraction.py:40-72`

**Step 1: 修改 run_step2**

```python
@router.post("/extraction/{document_id}/step2")
async def run_step2(
    document_id: str,
    mode: str = "standard",
    db: AsyncSession = Depends(get_db),
):
    svc = ExtractionService(db)
    result = await svc.run_step2(document_id, mode=mode)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
```

**Step 2: 修改 stream_step2**

```python
@router.get("/extraction/{document_id}/step2/stream")
async def stream_step2(
    document_id: str,
    mode: str = "standard",
    db: AsyncSession = Depends(get_db),
):
    """Stream step2 expand via SSE, saving the result when done."""
    svc = ExtractionService(db)

    async def event_generator():
        try:
            async for event, data in svc.run_step2_stream(document_id, mode=mode):
                payload = {"type": event, "text": data} if event == "chunk" else {"type": event, "result": data} if event == "done" else {"type": "error", "message": data}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                if event == "error":
                    return
        except Exception as exc:
            logger.exception("Stream step2 error")
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('app/api/extraction.py').read()); print('OK')"`
Expected: `OK`

**Step 4: 手工启动后端并测试 query param**

```bash
cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend
uvicorn app.main:app --reload &
sleep 2
# 检查 OpenAPI 文档反映新参数
curl -s http://localhost:8000/openapi.json | python -c "import sys, json; d=json.load(sys.stdin); params=d['paths']['/extraction/{document_id}/step2']['post']['parameters']; assert any(p['name']=='mode' for p in params); print('API OK')"
kill %1
```
Expected: `API OK`

**Step 5: Commit**

```bash
git add backend/app/api/extraction.py
git commit -m "feat: /extraction/{id}/step2 端点支持 mode 查询参数"
```

---

### Task 8: 评估实验室新增 proposition 策略档位

**Files:**
- Modify: `backend/app/services/evaluation_service.py:17-33`（STRATEGIES）、`88-106`（_evaluate_strategy）

**Step 1: 新增 STRATEGIES.proposition**

在 `STRATEGIES` 字典中加（在 detailed 之后）：

```python
    "proposition": {
        "label": "命题化",
        "temperature": 0.3,
        "extra_instruction": "",
        "mode": "proposition",
    },
```

同时给已有的 concise/standard/detailed 加 `"mode": "standard"`：

```python
STRATEGIES: dict[str, dict[str, Any]] = {
    "concise": {
        "label": "简洁",
        "temperature": 0.1,
        "extra_instruction": "只提取文章最核心的主题和主张，忽略次要实体。目标 5-8 个节点。",
        "mode": "standard",
    },
    "standard": {
        "label": "标准",
        "temperature": 0.3,
        "extra_instruction": "",
        "mode": "standard",
    },
    "detailed": {
        "label": "详细",
        "temperature": 0.6,
        "extra_instruction": "尽可能详细展开，包括次要概念、具体工具和方法。目标 15-25 个节点。",
        "mode": "standard",
    },
    "proposition": {
        "label": "命题化",
        "temperature": 0.3,
        "extra_instruction": "",
        "mode": "proposition",
    },
}
```

**Step 2: 修改 _evaluate_strategy 传 mode**

把当前调用 `run_expand(...)` 的部分（约 104 行）改为：

```python
        expanded = await self.extractor.run_expand(
            title, content, skeleton,
            temperature=temp, extra_instruction=extra,
            mode=strategy.get("mode", "standard"),
        )
```

**Step 3: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.services.evaluation_service import STRATEGIES; assert 'proposition' in STRATEGIES; assert STRATEGIES['proposition']['mode'] == 'proposition'; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/services/evaluation_service.py
git commit -m "feat: 评估实验室新增 proposition（命题化）档位"
```

---

### Task 9: 前端 types/graph.ts 扩展 NodeType

**Files:**
- Modify: `frontend/src/types/graph.ts:1-16`（NodeType 联合）、`213-235`（NODE_COLORS）、`231-235`（NODE_TYPES）

**Step 1: 修改 NodeType 联合**

```typescript
export type NodeType =
  | 'article'
  | 'concept'
  | 'claim'
  | 'topic'
  | 'person'
  | 'organization'
  | 'paper'
  | 'project'
  | 'framework'
  | 'tool'
  | 'method'
  | 'technology'
  | 'question'
  | 'chunk'
  | 'partition'
  | 'proposition'
  | 'section';
```

**Step 2: 修改 NODE_COLORS**

```typescript
export const NODE_COLORS: Record<string, string> = {
  article: '#3b82f6',
  concept: '#10b981',
  claim: '#f97316',
  topic: '#8b5cf6',
  person: '#fbbf24',
  organization: '#6366f1',
  paper: '#0ea5e9',
  project: '#14b8a6',
  framework: '#f59e0b',
  tool: '#ec4899',
  method: '#64748b',
  technology: '#22c55e',
  question: '#a855f7',
  chunk: '#94a3b8',
  partition: '#6366f1',
  proposition: '#d946ef',  // 浅紫，区别于 claim 的橙色
  section: '#cbd5e1',      // 浅灰，弱化
};
```

**Step 3: 修改 NODE_TYPES**

```typescript
export const NODE_TYPES: NodeType[] = [
  'article', 'concept', 'claim', 'topic', 'person', 'organization',
  'paper', 'project', 'framework', 'tool', 'method', 'technology', 'question',
  'partition', 'proposition', 'section',
];
```

**Step 4: 类型检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/types/graph.ts
git commit -m "feat: 前端 NodeType 新增 proposition 和 section"
```

---

### Task 10: 前端 api/client.ts streamStep2 支持 mode

**Files:**
- Modify: `frontend/src/api/client.ts:138-186`（streamStep2）

**Step 1: 修改 streamStep2 签名**

```typescript
export async function streamStep2(
  documentId: string,
  onChunk: (text: string) => void,
  mode: 'standard' | 'proposition' = 'standard',
): Promise<{ session_id: string; step: number; mode: string; data: { nodes: unknown[]; edges: unknown[] } }> {
  const url = mode === 'proposition'
    ? `/api/extraction/${documentId}/step2/stream?mode=proposition`
    : `/api/extraction/${documentId}/step2/stream`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { session_id: string; step: number; mode: string; data: { nodes: unknown[]; edges: unknown[] } } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      if (msg.type === 'chunk') {
        onChunk(msg.text);
      } else if (msg.type === 'done') {
        result = msg.result;
      } else if (msg.type === 'error') {
        throw new Error(msg.message || 'Stream error');
      }
    }
  }

  if (!result) throw new Error('Stream ended without result');
  return result;
}
```

**Step 2: 类型检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: streamStep2 支持 mode 参数"
```

---

### Task 11: ExtractionWizardPage 加模式切换 UI

**Files:**
- Modify: `frontend/src/pages/ExtractionWizardPage.tsx`

**Step 1: 新增 mode state**

在 `const [edges, setEdges] = useState<EdgeItem[]>([]);`（约 40 行）后加：

```typescript
  const [extractionMode, setExtractionMode] = useState<'standard' | 'proposition'>('standard');
```

**Step 2: 修改 handleSaveStep1 传 mode**

在 `streamStep2(documentId, ...)` 调用处（约 72 行）改为：

```typescript
      const res = await streamStep2(documentId, (chunk) => {
        chunkBufferRef.current += chunk;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            setStreamingText((prev) => prev + chunkBufferRef.current);
            chunkBufferRef.current = '';
            flushTimerRef.current = null;
          }, 80);
        }
      }, extractionMode);
```

**Step 3: 在 Step 1 确认按钮上方加模式选择 UI**

找到 Step 1 的"确认骨架并展开图谱"按钮所在 `<div>`（约 263 行），在其上方插入：

```tsx
          {/* 抽取模式切换 */}
          <div style={{ marginTop: 20, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, color: '#92400e' }}>抽取模式（实验性）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" checked={extractionMode === 'standard'} onChange={() => setExtractionMode('standard')} />
                标准（默认，topic + claim + 实体）
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" checked={extractionMode === 'proposition'} onChange={() => setExtractionMode('proposition')} />
                命题化（每个 claim 展开为 3-7 个自包含命题，还原度更高但节点更多）
              </label>
            </div>
          </div>
```

**Step 4: 类型检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/pages/ExtractionWizardPage.tsx
git commit -m "feat: 抽取向导新增模式切换 UI"
```

---

### Task 12: EvaluationLabPage 新增命题化档位

**Files:**
- Modify: `frontend/src/pages/EvaluationLabPage.tsx`

**Step 1: 修改 STRATEGY_LABELS**

找到第 32-36 行 `STRATEGY_LABELS` 常量，改为：

```typescript
const STRATEGY_LABELS: Record<string, string> = {
  concise: '简洁',
  standard: '标准',
  detailed: '详细',
  proposition: '命题化',
};
```

**Step 2: 修改默认策略 state**

找到第 47 行：

```typescript
  const [strategies, setStrategies] = useState<string[]>(['concise', 'standard', 'detailed']);
```

保持默认不变（命题化成本高，不默认勾选）。

**Step 3: 修改策略复选框列表**

找到第 106 行：

```typescript
            {['concise', 'standard', 'detailed'].map(s => (
```

改为：

```typescript
            {['concise', 'standard', 'detailed', 'proposition'].map(s => (
```

**Step 4: 类型检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/pages/EvaluationLabPage.tsx
git commit -m "feat: 评估实验室前端新增命题化档位"
```

---

### Task 13: 端到端冒烟测试

**Files:**
- 无修改，仅验证

**Step 1: 启动后端**

```bash
cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend
uvicorn app.main:app --reload &
BACKEND_PID=$!
sleep 3
```

**Step 2: 检查 OpenAPI 反映所有改动**

```bash
curl -s http://localhost:8000/openapi.json | python -c "
import sys, json
d = json.load(sys.stdin)
# 检查 step2 支持 mode 参数
params = d['paths']['/extraction/{document_id}/step2']['post']['parameters']
assert any(p['name'] == 'mode' for p in params), 'step2 missing mode param'
# 检查 stream 端点支持 mode 参数
params = d['paths']['/extraction/{document_id}/step2/stream']['get']['parameters']
assert any(p['name'] == 'mode' for p in params), 'stream missing mode param'
print('API contracts OK')
"
```
Expected: `API contracts OK`

**Step 3: 找一个已有 document_id 做真实抽取测试**

```bash
# 列出最近的 document
curl -s 'http://localhost:8000/api/documents?skip=0&limit=5' | python -c "
import sys, json
d = json.load(sys.stdin)
docs = d.get('documents', d) if isinstance(d, dict) else d
if docs:
    print(f'Latest doc: {docs[0][\"id\"]} - {docs[0][\"title\"]}')
else:
    print('No documents found, import one first')
"
```

如果库里有文档，记下 document_id，执行：

```bash
DOC_ID=<上一步的 id>

# 1. 跑 step1
curl -s -X POST "http://localhost:8000/api/extraction/$DOC_ID/step1" | python -c "import sys,json; d=json.load(sys.stdin); print(f'Step1: {len(d[\"data\"][\"topic_tags\"])} tags, {len(d[\"data\"][\"core_claims\"])} claims')"

# 2. 跑 step2 用 proposition 模式
curl -s -X POST "http://localhost:8000/api/extraction/$DOC_ID/step2?mode=proposition" | python -c "
import sys, json
d = json.load(sys.stdin)
nodes = d['data']['nodes']
edges = d['data']['edges']
prop_count = sum(1 for n in nodes if n.get('node_type') == 'proposition')
claim_count = sum(1 for n in nodes if n.get('node_type') == 'claim')
print(f'Step2 (proposition): {len(nodes)} nodes ({prop_count} propositions, {claim_count} claims), {len(edges)} edges')
assert prop_count > 0, 'No propositions generated!'
print('Smoke test PASSED')
"
```
Expected:
```
Step1: N tags, M claims
Step2 (proposition): X nodes (Y propositions, Z claims), W edges
Smoke test PASSED
```

**Step 4: 关闭后端**

```bash
kill $BACKEND_PID
```

**Step 5: 如果测试失败**

- 如果没生成 proposition：检查 LLM 是否支持，查看 `backend/logs/` 或 stderr
- 如果 description 全部 <30 被丢弃：调整 prompt 强化"自包含 ≥30 字"要求
- 如果 LLM 不返回 parent_claim_id：在 Task 5 的 prompt 中加更明确的示例

---

### Task 14: 写 A/B 实验脚本（可选，加速对比）

**Files:**
- Create: `backend/scripts/proposition_ab_test.py`

**Step 1: 创建脚本**

```python
#!/usr/bin/env python3
"""命题化 vs 标准 A/B 对比实验。

用法:
    python scripts/proposition_ab_test.py <document_id>

输出:
    - 两组抽取结果（graph JSON）
    - 重建知识点对比
    - 评分差异
"""
import asyncio
import json
import sys
from pathlib import Path

# 把 backend 加到 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.services.evaluation_service import EvaluationService


async def main(document_id: str):
    engine = create_async_engine(settings.DATABASE_URL)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        svc = EvaluationService(db)
        # 只对比 standard vs proposition，避免噪音
        result = await svc.run_evaluation(
            document_id, ["standard", "proposition"]
        )

    print("=" * 60)
    print(f"Document: {result['document_title']}")
    print(f"Ground Truth: {len(result['ground_truth'])} 知识点")
    print("=" * 60)

    for r in result["results"]:
        if "error" in r:
            print(f"\n[{r['strategy']}] ERROR: {r['error']}")
            continue
        s = r["scores"]
        print(f"\n[{r['strategy']}] {r['label']}")
        print(f"  Recall:    {s['recall']*100:.0f}%")
        print(f"  Precision: {s['precision']*100:.0f}%")
        print(f"  F1:        {s['f1']*100:.0f}%")
        print(f"  Nodes:     {s['node_count']}  Edges: {s['edge_count']}")
        if s.get("missed"):
            print(f"  Missed:    {len(s['missed'])}")
        if s.get("hallucinated"):
            print(f"  Hallucinated: {len(s['hallucinated'])}")

    # 保存详细结果
    out_path = Path(f"/tmp/ab_test_{document_id}.json")
    with open(out_path, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n详细结果已保存到: {out_path}")

    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/proposition_ab_test.py <document_id>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
```

**Step 2: 语法检查**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "import ast; ast.parse(open('scripts/proposition_ab_test.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/scripts/proposition_ab_test.py
git commit -m "feat: 新增命题化 A/B 实验脚本"
```

---

## 决策门：Phase 1 验收标准

完成 Task 1-13 后，在 1-3 篇真实文章上跑 A/B 实验（Task 14 的脚本或 `/eval` 页面）。

**进入 Phase 2 的条件**（必须全部满足）：
- [ ] Proposition 模式能稳定生成 proposition 节点（每篇 ≥5 个）
- [ ] Proposition 的 description 平均长度 ≥40 字（自包含）
- [ ] Proposition 模式的 F1 比 standard 高 ≥15%（相对提升）
- [ ] 命题数控制在合理范围（每篇 ≤80 个 proposition）
- [ ] 没有破坏现有 standard 模式（回归测试通过）

**如果未达标**：分析失败模式（是 prompt 问题？LLM 能力不够？校验太严？），调整后重新实验。Phase 2 不进入。

---

## 不在 Phase 1 范围内（留给 Phase 2/3）

- 默认 mode 切换为 proposition
- ClusteringService 适配（topic 聚类只到 claim 层级）
- Node 表加 parent_node_id 字段
- /graph/global 过滤规则（默认隐藏 proposition）
- 命题级 chunk embedding
- SearchService / QAService 升级

---

## 参考资料

- 设计文档：`docs/plans/2026-06-19-proposition-extraction-design.md`
- Tree-KG 论文：https://aclanthology.org/2025.acl-long.907.pdf
- Dense X Retrieval 论文：https://arxiv.org/html/2312.06648v2
- TDD 技能：@superpowers:test-driven-development
- 执行计划技能：@superpowers:executing-plans
