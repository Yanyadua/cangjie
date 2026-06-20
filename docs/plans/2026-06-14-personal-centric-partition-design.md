# 以"我"为核心的个人分区化全局图谱 — 设计文档

> 日期：2026-06-14
> 状态：已确认，待实现

## 背景与目标

当前全局图谱是扁平的 topic + article 网络，缺少宏观的组织层次。用户希望全局图谱以"我"为中心，能够创建主题分区（如"智能体分区""投资分区"），导入的文章自动挂载到匹配的分区下。

**核心体验**：用户导入一篇智能体文章 → 系统自动建议挂载到"智能体分区" → 用户在聚类提案页确认 → 文章归入分区，全局图呈现 `我 → 分区 → topic → article` 的层次结构。

## 设计决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 分区层次 | 分区比 topic 更粗：`我 → 分区 → topic → article` |
| 挂载时机 | 聚类提案阶段确认，复用现有提案 UI |
| 分区归属 | 唯一分区（1:1），一篇文章只属于一个分区 |
| 未匹配处理 | 建议建新分区，分区库随使用自生长 |
| 数据模型 | 复用 Node 表，partition/person 作为 node_type |

## 1. 数据模型与初始化

### 1.1 类型白名单扩展

**新增 node_type**：
- `partition` — 分区节点
- `person` — "我"节点（系统唯一，全局图根节点）

涉及文件：`backend/app/core/graph_extractor.py` 的 `VALID_NODE_TYPES`、`frontend/src/types/graph.ts` 的 `NodeType` 联合类型和 `NODE_TYPES` 数组。

**新增 relation_type**：
- `root` — `person → partition`，表示分区归属"我"
- `belongs_to` — `article → partition`，表示文章的唯一分区归属

涉及文件：`VALID_RELATION_TYPES`、`RelationType` 联合类型和 `RELATION_TYPES` 数组。

**复用已有 relation_type**：
- `part_of` — `topic → partition`，topic 隶属分区

### 1.2 边关系全景

```
我(person) --root--> 智能体分区(partition)
智能体分区(partition) <--part_of-- RAG(topic)
智能体分区(partition) <--belongs_to-- GraphRAG论文(article)
GraphRAG论文(article) --tag--> RAG(topic)        [已有机制]
```

### 1.3 "我"节点懒初始化

不修改 `init_db.py`。在 `GraphStore` 中新增 `_ensure_me_node()` 方法，`PartitionService` 和 `ClusteringService` 需要时调用：

```python
async def ensure_me_node(self) -> UUID:
    """获取或创建唯一的 person 节点。"""
    result = await self.db.execute(
        select(Node).where(Node.node_type == 'person').limit(1)
    )
    me = result.scalar_one_or_none()
    if me:
        return me.id
    me_id = await self.create_node(
        node_type='person', name='我',
        description='知识图谱中心节点'
    )
    return me_id
```

### 1.4 分区 embedding

分区创建时，用 `name + description` 生成 embedding 存入 `node.embedding`。匹配时复用 `VectorStore.search_nodes(node_type='partition')`。

## 2. 分区匹配算法与流程改造

### 2.1 匹配算法

在 `ClusteringPlanner.generate_proposal()` 的 tag 匹配之前，插入分区匹配：

```
输入：article_title, article_summary, topic_tags[]

Step 1: 摘要向量匹配
  emb_summary = embed(article_summary)
  partition_hits = VectorStore.search_nodes(emb_summary, node_type='partition', top_k=3)

Step 2: 标签向量匹配（加权）
  对每个 tag: emb_tag = embed(tag.name)
  tag_hits = VectorStore.search_nodes(emb_tag, node_type='partition', top_k=1)
  tag_scores = { partition_id: max_similarity across tags }

Step 3: 综合评分
  for each candidate partition:
    score = 0.6 * 摘要相似度 + 0.4 * tag 最高相似度
  best = max(score)

Step 4: 决策
  if best.score >= 0.72:  → MATCH（建议挂载到已有分区）
  else:                   → NEW（调 LLM 生成新分区名+描述）
```

**阈值 0.72** 依据：现有 topic MERGE 阈值 0.85（强匹配），聚类检索阈值 0.8。分区是更粗粒度，阈值应更低。取 0.72 作为起始值，可通过配置调整。

### 2.2 LLM 生成新分区（仅 NEW 场景）

无强匹配时，用一个小 prompt 让 LLM 基于文章摘要和 tags 生成分区建议：

```
输入：{ article_title, article_summary, topic_tags, existing_partition_names }
输出 JSON：{
  "partition_name": "知识管理",
  "description": "涉及信息组织、笔记法、知识图谱等",
  "reason": "现有分区无强匹配，文章聚焦于..."
}
```

关键：传入 `existing_partition_names` 防止 LLM 生成与已有分区重复的名字。

### 2.3 聚类提案 JSON 结构扩展

`proposal_json` 新增 `partition_action` 字段：

```json
{
  "article_title": "...",
  "article_summary": "...",
  "document_id": "...",
  "partition_action": {
    "action": "MATCH",
    "target_partition_id": "uuid...",
    "target_partition_name": "智能体分区",
    "score": 0.87,
    "candidates": [
      {"id": "...", "name": "智能体分区", "score": 0.87},
      {"id": "...", "name": "技术分区", "score": 0.65}
    ],
    "reason": "摘要和标签与智能体分区高度匹配"
  },
  "tag_actions": [ ... ],
  "topic_edges": [ ... ]
}
```

NEW 场景下 `action="NEW"`，带 `proposed_name` / `proposed_description`，无 `target_partition_id`。

### 2.4 apply_proposal() 改造

现有 apply 逻辑（创建 article 节点 + topic 节点 + 建边）基础上新增：

1. **处理 partition_action**：
   - `MATCH`：取 `target_partition_id`
   - `NEW`：`graph_store.create_node(node_type='partition', ...)` + 生成 embedding + 确保 `me --root--> 新分区`
2. **article 创建后**：`graph_store.create_edge(article, partition, 'belongs_to')`
3. **topic 创建/merge 后**：确保 `topic --part_of--> partition`（NEW topic 直接建边；MERGE 的 topic 如果还没 part_of 任何分区，也建边）

### 2.5 与现有 topic 聚类的关系

现有 tag_actions 的 MERGE/NEW 逻辑不变。topic 仍然是全局的，但每个 topic 通过 `part_of` 归属到一个分区。MERGE 时如果目标 topic 已经 part_of 其他分区，不强制改归属（topic 可跨分区引用，但物理 part_of 一个分区）。

## 3. API 与前端

### 3.1 新增后端 API

**`backend/app/api/partitions.py`**（新文件）：

| 端点 | 用途 |
|------|------|
| `GET /partitions` | 列出所有分区，附带每个分区下的 article 数和 topic 数 |
| `POST /partitions` | 手动创建分区（name + description），自动生成 embedding，自动建 `me --root--> 分区` |
| `PUT /partitions/:id` | 编辑分区名称/描述，description 变更时重新生成 embedding |
| `DELETE /partitions/:id` | 删除分区（分区下的 article 变成无分区孤儿，不级联删） |

`PartitionService`（新文件 `backend/app/services/partition_service.py`）封装上述逻辑，依赖 `GraphStore` + `EmbeddingClient` + `VectorStore`。

### 3.2 前端类型扩展（`types/graph.ts`）

```typescript
// NodeType 追加
| 'partition'
| 'person'

// RelationType 追加
| 'root'
| 'belongs_to'

// NODE_COLORS 追加
partition: '#6366f1',  // 靛蓝
person: '#fbbf24',     // 金色（"我"节点醒目）

// 聚类提案新增类型
type PartitionAction = {
  action: 'MATCH' | 'NEW';
  target_partition_id?: string;
  target_partition_name?: string;
  proposed_name?: string;
  proposed_description?: string;
  score: number;
  candidates: Array<{ id: string; name: string; score: number }>;
  reason: string;
};

// ClusteringProposalJSON 追加字段
partition_action: PartitionAction;
```

### 3.3 聚类提案页改造（`ClusteringProposalPage.tsx`）

在现有页面顶部（tag_actions 之前）新增分区选择卡片：

- MATCH 场景：默认选中相似度最高的分区，下拉可切换到其他候选或"新建"
- NEW 场景：默认选中"新建"，分区名和描述可编辑，也可切换到"挂载已有"
- 用户不操作则按系统建议执行

### 3.4 全局图页改造（`GlobalGraphPage.tsx`）

**节点展示**：
- `person`（"我"）— 金色，固定居中，大圆
- `partition` — 靛蓝，比 topic 大一号，围绕"我"节点
- `topic` / `article` — 现有样式，归属在分区内聚

**布局策略**：dagre 分层布局，`me` 在第 0 层，`partition` 第 1 层，`topic` 第 2 层，`article` 第 3 层。

**过滤器新增**：现有 `all/topic/article` 三按钮追加 `partition` 视图（只看"我"+分区概览）。

## 改动文件清单

### 后端
| 文件 | 改动 |
|------|------|
| `core/graph_extractor.py` | `VALID_NODE_TYPES` 加 partition/person，`VALID_RELATION_TYPES` 加 root/belongs_to |
| `core/graph_store.py` | 新增 `ensure_me_node()` 方法 |
| `core/clustering_planner.py` | 新增分区匹配步骤 + LLM 新分区生成 prompt |
| `services/clustering_service.py` | `generate_proposal` 返回 partition_action，`apply_proposal` 处理分区建边 |
| `services/partition_service.py` | **新文件**，分区 CRUD + embedding 管理 |
| `api/partitions.py` | **新文件**，分区 REST API |
| `main.py` | 注册 partitions router |
| `models/schemas.py` | 新增 PartitionAction schema、分区相关请求/响应模型 |

### 前端
| 文件 | 改动 |
|------|------|
| `types/graph.ts` | NodeType/RelationType 扩展、PartitionAction 类型、NODE_COLORS |
| `api/client.ts` | 新增分区 CRUD 函数 |
| `pages/ClusteringProposalPage.tsx` | 新增分区选择卡片 |
| `pages/GlobalGraphPage.tsx` | 支持显示 person/partition 节点、层次布局、分区过滤 |
| `components/GraphEditor.tsx` | 支持新节点类型的渲染样式（如有需要） |
