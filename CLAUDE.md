# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

支持人工校正的增量式个人知识图谱系统。不是普通 RAG（只切 chunk 做向量检索），而是把每篇文章转成**语义向量结构 + 显式图谱结构**双重表示，用户可视化校正后以 graph patch 方式增量更新全局图谱。

核心流程：`导入 → 清洗/分块/向量化 → 两阶段图抽取（骨架→展开）→ 人工校正 → 确认入库 → 聚类提案 → 应用到全局图谱`

## 常用命令

### 后端（在 `backend/` 目录下）

```bash
pip install -r requirements.txt
cp .env.example .env          # 编辑填入 DB 连接和 LLM API key
uvicorn app.main:app --reload  # 启动开发服务器，端口 8000
python init_db.py              # 建表（需先手动创建 PG 数据库并安装 pgvector 扩展）
```

### 前端（在 `frontend/` 目录下）

```bash
npm install
npm run dev                   # Vite 开发服务器，端口 5173，代理 /api → localhost:8000
./node_modules/.bin/tsc --noEmit  # 类型检查（注意：必须用本地 tsc，全局版本可能过旧）
npm run build                 # 生产构建
```

### 数据库

PostgreSQL 15+ 需安装 pgvector 扩展。数据库配置在 `backend/.env` 的 `DATABASE_URL`。

## 架构概览

### 后端三层架构

```
api/        薄路由层 — 只做参数解析、依赖注入、HTTP 异常转换
services/   业务编排层 — 所有业务逻辑都在这里，每个领域一个 Service 类
core/       基础设施层 — LLM/Embedding 客户端、图存储、向量存储、抽取器、校验器
```

**关键约定**：API 路由实例化 `XxxService(db)` 后委托执行，不在路由里写业务逻辑。Service 返回 `{"error": "..."}` 表示业务错误，API 层转换成 `HTTPException`。

### 数据模型与状态机

7 张表（`models/db_models.py`）：`Document`、`Chunk`、`Node`、`NodeAlias`、`Edge`、`DraftGraph`、`GraphPatch`、`InsertionProposal`。

DraftGraph 是抽取流程的核心载体，`graph_json` (JSONB) 按 step 推进：
- `step:1` skeleton（摘要 + 主题标签 + 核心主张）
- `step:2` expanded（完整 nodes + edges）
- finalize 后变为 `{summary, nodes, edges}` 最终格式

**重要**：修改 JSONB 字段后必须 `flag_modified(obj, "field_name")`，否则 SQLAlchemy 不会检测到变更。深拷贝技巧：`obj.field = json.loads(json.dumps(obj.field))`。

### 图抽取管线（`core/graph_extractor.py`）

两阶段渐进式抽取（当前主路径）：
1. `run_skeleton()` — 文章级骨架（摘要、主题标签、核心主张）
2. `run_expand()` / `run_expand_stream()` — 展开为完整图谱

另有遗留的 4 阶段管线（`_extract_multistage`，stage1-4），以及单阶段 fallback。

**类型白名单严格校验**（`_validate_and_sanitize`）：
- 节点类型：`VALID_NODE_TYPES`（article/concept/claim/topic/person/organization/paper/project/framework/tool/method/technology/question）
- 关系类型：`VALID_RELATION_TYPES`（related_to/contains/part_of/supports/contradicts/depends_on/implements/improves/causes/compares_with/derived_from/used_for/evidence_for/mentions/similar_to/belongs_to）
- 非法类型节点被丢弃，非法关系类型降级为 `related_to`

LLM 输出经 `_strip_json_markdown()` 去除 ```json 包裹后解析。`_calibrate_confidence()` 根据证据与原文相似度调整置信度。

### 流式响应（SSE）

Step2 展开支持流式传输，全链路：
- `LLMClient.generate_stream()` — httpx stream + aiter_lines 解析上游 SSE
- `GraphExtractor.run_expand_stream()` — yield `("chunk", text)` / `("done", result)` / `("error", msg)`
- `ExtractionService.run_step2_stream()` — 包装并在完成时持久化
- `GET /extraction/{id}/step2/stream` — FastAPI `StreamingResponse(media_type="text/event-stream")`
- 前端 `streamStep2()` — fetch + `response.body.getReader()` 消费 SSE，80ms 节流更新 UI

### 前端结构

- 无 CSS 框架，全部内联样式（`style={{...}}`）
- `api/client.ts` 统一 API 客户端（axios + 原生 fetch 用于 SSE）
- `types/graph.ts` 定义 NodeType/RelationType 联合类型、NODE_COLORS 颜色映射、NODE_TYPES/RELATION_TYPES 常量数组
- `components/GraphEditor.tsx` 基于 @xyflow/react 的图谱编辑器
- `pages/ExtractionWizardPage.tsx` 三步抽取向导（骨架→展开→确认）

### 确认入库流程

`DraftGraphService.confirm_draft_graph()` → 触发 `ClusteringService.generate_proposal()` → 生成 InsertionProposal（tag_actions + topic_edges）→ 用户在 `/clustering/:id` 页面校正 → `apply_proposal()` 执行：创建 topic/article 节点、建边、生成 embedding。

### 搜索与问答

- `SearchService.semantic_search()` — chunk + node 双路向量检索（pgvector `<=>` 余弦距离）
- `graph_enhanced_search()` — 语义检索 + 1-hop 图扩展
- `QAService.ask()` — 图增强检索 → 构建上下文 → LLM 生成回答（附证据引用）

## 配置

`backend/.env`（参考 `.env.example`）：
- `DATABASE_URL` — PostgreSQL asyncpg 连接串
- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — OpenAI 兼容接口
- `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` — Embedding 接口

## 用户偏好

- **所有方案文档用中文**：设计文档、方案描述、注释说明等一律使用中文

## 关键设计决策

- **人工校正优先**：每个自动化步骤都有对应的人工编辑界面，DraftGraph 状态机让用户可在任意阶段回退修改
- **temp_id 解耦**：抽取阶段节点用 `temp_id`（如 `n1`/`n_${timestamp}`），入库时才分配真实 UUID，便于前端增删
- **证据驱动**：每条 edge 必须有 evidence（引用原文），`_calibrate_confidence` 据此调整可信度
- **全局图只存 topic + article 节点**：`/graph/global` 默认过滤只展示宏观结构，避免节点爆炸
