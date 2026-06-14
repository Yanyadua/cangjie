# 粗粒度渐进式抽取设计

**Goal:** 将当前3阶段抽取（概念→实体→关系）重构为2阶段（主题骨架→自动展开），从粗粒度到细粒度，减少用户审核负担。

**Architecture:** Step 1 只抓取摘要+标签+核心claim（主题骨架），Step 2 围绕每个claim自动展开实体和关系。数据模型不变，下游完全复用。

**Tech Stack:** FastAPI, React/TypeScript, DeepSeek LLM, DashScope Embedding

---

## 问题

当前流程一上来就把所有实体（人物、组织、概念、观点、方法...）全部抽出来，粒度太细，审核负担重。用户需要先看大局再深入细节。

## 新流程

```
当前3步：                          新2步：
Stage1: 摘要+核心概念              Step1: 主题骨架（摘要+标签+核心claim）
Stage2: 全部实体节点      ──→      Step2: 自动展开（实体+关系一起出）
Stage3: 全部关系                    ──
Finalize: 证据校验                  Finalize: 证据校验（不变）
草稿编辑                            草稿编辑（不变）
聚类提案                            聚类提案（不变）
```

### Step 1：主题骨架

**LLM 输入**：文章标题 + 全文

**LLM 输出**：
```json
{
  "summary": "1-2句话摘要",
  "topic_tags": [
    {"name": "检索增强生成", "confidence": 0.95},
    {"name": "知识图谱", "confidence": 0.9}
  ],
  "core_claims": [
    {
      "name": "GraphRAG在全局理解任务上优于传统RAG",
      "description": "通过知识图谱+社区检测，解决了传统RAG跨文档推理弱的问题"
    }
  ]
}
```

**对比当前 Stage 1**：
- 去掉 `core_concepts`（粗粒度不需要细分概念类型）
- 新增 `topic_tags`（直接服务于下游聚类，省掉 tag_generator 的独立 LLM 调用）
- 新增 `core_claims`（作为 Step 2 展开的锚点）

**前端界面**：摘要文本框 + 标签列表（可增删） + claim列表（可编辑名称和描述）

### Step 2：自动展开

**LLM 输入**：文章全文 + Step 1 骨架（summary + topic_tags + core_claims）

**LLM 做什么**：
1. 为每个 topic_tag 创建 topic 类型节点
2. 为每个 core_claim 创建 claim 类型节点
3. 围绕每个 claim 抽取支撑实体（person, method, concept, tool...）和关系
4. 创建 article 节点，连接到 topic 节点（tag 关系）和 claim 节点（contains 关系）

**关键**：一个 LLM 调用同时输出所有节点和关系（当前需要 Stage2+Stage3 两次调用）。

**前端界面**：内嵌 GraphEditor 展示完整图谱 + 节点/边列表编辑。确认后 Finalize。

### Finalize 和下游

不变。证据校验 → 草稿编辑 → 聚类提案 → 全局图谱。

---

## 后端改动

### `graph_extractor.py`（核心改动）
- 新增 `run_skeleton(title, content)` → `{summary, topic_tags, core_claims}`
- 新增 `run_expand(title, content, skeleton)` → `{nodes, edges}`
- 新增 prompt：`_SKELETON_SYSTEM`、`_EXPAND_SYSTEM`（含 few-shot）
- 保留 `_validate_evidence`、`_calibrate_confidence`、`_validate_and_sanitize`
- 删除 `run_stage1`、`run_stage2`、`run_stage3` 及对应 prompt

### `extraction.py` API（路由改名）
| 旧路由 | 新路由 | 作用 |
|--------|--------|------|
| `POST stage1` | `POST step1` | 运行骨架抽取 |
| `PUT stage1` | `PUT step1` | 保存骨架编辑 |
| `POST stage2` | `POST step2` | 运行展开 |
| `PUT stage2` | `PUT step2` | 保存图谱编辑 |
| `POST/PUT stage3` | 删除 | 合并进 step2 |
| `POST finalize` | 不变 | 证据校验 |

### `extraction_service.py`
- 新方法：`run_step1()` / `save_step1()` / `run_step2()` / `save_step2()` / `finalize()`
- DraftGraph 状态：`skeleton` → `expanded` → `draft` → `confirmed`

### `clustering_service.py`（简化）
- 不再调用 `tag_generator.py`（Step 1 已产出 topic_tags）
- 直接用骨架里的 topic_tags 做聚类匹配
- `tag_generator.py` 可删除

### 不动的文件
- `draft_graph_service.py`、`draft_graphs.py` API
- `clustering_planner.py`（仍负责 MERGE/NEW 决策）
- `graph_store.py`、`vector_store.py`

---

## 前端改动

### `ExtractionWizardPage.tsx`（主要改动）
- 进度条 4 步 → 3 步：`主题骨架` → `图谱展开` → `确认完成`
- Step 1：摘要 + 标签 + claim 编辑
- Step 2：内嵌 GraphEditor + 节点/边列表

### `api/client.ts`（函数改名）
| 旧函数 | 新函数 |
|--------|--------|
| `runStage1` / `saveStage1` | `runStep1` / `saveStep1` |
| `runStage2` / `saveStage2` | `runStep2` / `saveStep2` |
| `runStage3` / `saveStage3` | 删除 |
| `finalizeExtraction` | 不变 |

### `types/graph.ts`
- 新增 `CoreClaim`：`{ name: string; description: string }`
- 新增 `SkeletonData`：`{ summary: string; topic_tags: TopicTag[]; core_claims: CoreClaim[] }`

### 不动的页面
- `DraftGraphPage.tsx`、`ClusteringProposalPage.tsx`、`GlobalGraphPage.tsx`
- `GraphEditor.tsx` 组件

---

## 净效果

- LLM 调用：4 次 → 3 次（骨架 + 展开 + 校验）
- 用户审核步骤：3 步 → 2 步
- 聚类阶段额外省掉 tag_generator 的 1 次 LLM 调用
- 数据模型不变，下游完全复用
