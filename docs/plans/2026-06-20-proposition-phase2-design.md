# 命题级知识抽取 Phase 2 设计文档：命题融入全局图

> **目标：** 把 Phase 1 抽出的高质量命题从"只存在于 DraftGraph 的 JSON"升级为"全局图的一等公民"，让用户在全局图上能看到/下钻到每篇文章的 claim 和 proposition，闭环 Phase 1 的质量优势。

## 背景：Phase 1 A/B 验证结论

Phase 1（`?mode=proposition` 实验参数）已验证命题化模式质量。两轮 A/B 数据：

### Prompt 调优前后对比（同 1 篇文章）

| 指标 | 第一轮 | 第二轮（cap 7→5 + SKIP 清单） |
|------|-------:|----------------------------:|
| Recall | 100% | 90% |
| Precision | 45% | **90%** |
| F1 | 63% | **90%** |

### 多文档验证（5 篇 vs 最强 baseline `detailed`）

| 文档 | detailed F1 | proposition F1 | 相对提升 |
|------|-----------:|---------------:|---------:|
| 只要13个单词 | 74% | 90% | +21.6% |
| Sam Altman 短新闻 | 67% | 82% | +23.5% |
| 知识蒸馏综述 | 52% | 78% | +50.0% |
| 对比学习视觉表征 | 63% | 57% | **-9.5%** |
| Data Infra 错配 | 44% | 62% | +39.7% |
| **平均 F1** | **60%** | **74%** | **+23%** |

**结论**：4/5 篇胜出，平均相对 F1 提升 +23%，超过 Phase 2 决策门槛（≥15%）。唯一输的对比学习视觉表征是高度抽象的理论文，提示应在 UI 引导用户对抽象文用 `standard` 模式。

## 探索阶段发现的 5 个 Gap

| Gap | 当前问题 | Phase 2 决策 |
|-----|---------|-------------|
| 1. 入库丢弃命题 | `ClusteringService.apply_proposal` 只入库 partition/topic/article，draft graph 里的 claim/proposition 全部丢弃 | **修**：扩展 apply_proposal，claim + proposition 入 Node 表 |
| 2. 父子关系无字段 | Node 表无层级关系字段，proposition → claim 只能用 edge 表达，语义不清晰 | **加 `parent_node_id` 字段**（外键到 nodes.id，nullable，部分索引） |
| 3. 全局图无层级展示 | `/graph/global` 默认只显示 topic+article，看不到 claim/proposition | **宏观图 + 下钻**：新增 `/graph/article/{id}` 子图端点，前端浮层面板 |
| 4. 默认模式 + 抽象文路由 | A/B 显示抽象理论文 proposition 输 9.5%，不能一刀切默认 | **手动切换 + 提示**：默认改 proposition，UI 提示抽象文用 detailed |
| 5. ClusteringService 适配含义模糊 | Phase 1 设计文档说"topic 聚合到 claim 层级"但当前代码根本没碰 claim | **最小适配**：apply_proposal 处理 proposition draft 不报错不漏数据；ClusteringPlanner 不为 claim/proposition 生成合并建议 |

## 总体架构与数据流

**核心理念**：双层视图解决节点爆炸——

```
全局宏观图（/graph/global）           单文下钻图（/graph/article/{id}）
  topic ← tag → article                article
    └─ belongs_to ─→ partition           ├─ contains → claim
                                          │             ├─ parent_node_id → proposition
                                          │             └─ parent_node_id → proposition
                                          └─ contains → claim
```

**数据流改动**：

```
ExtractionWizardPage                   ClusteringProposalPage
  ↓ mode=proposition（默认）             ↓ apply
  ↓                                       ↓
DraftGraph.graph_json                  ★ 新增：claim + proposition 节点入 Node 表
  {summary, nodes, edges}                 （parent_node_id 填充）
                                          + claim/proposition 之间的 edge 入 Edge 表
                                          ↓
                                        全局宏观图保持 topic+article 不变
                                          ↓
                                        用户点 article 节点
                                          ↓
                                        /graph/article/{id} 返回该文 claim+proposition 子图
```

**关键不变量**：
- 全局宏观图节点数不变（仍只有 topic + article + partition + person）
- proposition 永远挂在 claim 下（parent_node_id 非空）
- 向后兼容：standard 模式的旧 draft graph 仍能正常入库

## § 1 数据模型

### Node 表新增字段

```python
# backend/app/models/db_models.py
class Node(Base):
    # ... 现有字段 ...
    parent_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("nodes.id"),
        nullable=True,         # 仅 proposition 非空，其他类型一律 None
        index=True,
    )
```

**字段语义**：
- 自引用外键（nodes.id → nodes.id）
- 仅 proposition 节点会填，claim/article/topic 等永远为 None
- 物理上不强制约束"只有 proposition 才能填"，但应用层保证

### Migration 脚本

新增 `backend/scripts/migrate_phase2.py`（idempotent）：

```python
"""Phase 2 migration: add parent_node_id to nodes."""
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
    print("Phase 2 migration done.")

if __name__ == "__main__":
    asyncio.run(migrate())
```

**为什么部分索引**（`WHERE parent_node_id IS NOT NULL`）：
- 全局 99% 节点的 parent_node_id 是 NULL
- 部分索引只为 proposition 行建索引，节省空间且查询更快

### GraphStore.create_node 扩展

```python
async def create_node(
    self,
    node_type: str,
    name: str,
    description: Optional[str] = None,
    canonical_name: Optional[str] = None,
    source_document_id: Optional[UUID] = None,
    parent_node_id: Optional[UUID] = None,   # ★ 新增
) -> UUID:
    ...
```

向后兼容：默认 None，现有所有调用（topic/article/partition 创建）无需改动。

## § 2 入库流程（Gap 1 修复——Phase 2 核心）

### 当前问题

`ClusteringService.apply_proposal`（`clustering_service.py:121-285`）当前流程：

```
1. 处理 partition_action（创建/匹配分区）
2. 处理 tag_actions（创建/合并 topic）
3. 创建 article 节点
4. 建 article → partition 边
5. 建 article → topic 边
6. 建 topic ↔ topic 边
7. ★ draft graph 里的 claim / proposition / concept / method / tool 全部丢弃
```

→ Phase 1 抽出的高质量命题，确认入库后**直接消失**。

### Phase 2 改造：在第 6 步之后追加"知识节点入库"

```
1-6. 当前流程不变（partition / topic / article / 顶层 edge）
 7. ★ 遍历 draft_graph.nodes，按 temp_id 顺序入库：
     - 维护 temp_id → UUID 映射 dict
     - claim 节点 → create_node(node_type="claim",
                                  parent_node_id=None,
                                  source_document_id=document_id)
     - proposition 节点 → create_node(node_type="proposition",
                                        parent_node_id=<映射查 claim UUID>,
                                        source_document_id=document_id)
     - 其他语义节点（concept/method/tool/person/...）→ create_node（无 parent）
     - 跳过 topic（第 2 步已处理）和 article（第 3 步已处理）
 8. ★ 遍历 draft_graph.edges，翻译并建边：
     - source/target 从 temp_id 翻译成 UUID
     - 跳过系统边（article→topic 的 tag、article→partition 的 belongs_to）
     - 剩余边（claim↔proposition 的 evidence_for、proposition↔proposition 的 causes 等）
       → create_edge(..., evidence_text=edge.evidence, confidence=edge.confidence)
 9. ★ 建 article → claim 的 contains 边（让 claim 能反向找到 article）
10. status = applied
```

### 关键设计点

**A. temp_id → UUID 映射贯穿全程**
```python
temp_to_uuid: dict[str, UUID] = {}
# 第 7 步遍历时填充；第 8 步建边时查询翻译
```
顺序保证：proposition 入库前其 parent claim 必须已入库（按 draft_graph.nodes 原顺序，proposition 永远在 claim 之后——Phase 1 prompt 保证）。

**B. description 直接落库**
- proposition 的 description 是自包含陈述（≥30 字），直接存 `Node.description`
- 不做二次加工，保留人工校正的原文

**C. 向后兼容 standard 模式（顺带修复）**
- standard 模式的 draft graph 也有 claim 节点，只是没 proposition
- Phase 2 改造后，**standard 模式的 claim 也会被入库**（之前也丢了）——免费 bonus fix

**D. 不做自动跨文合并**
- 两篇文章出现同名 claim（如"F1=0.73"）→ 各自独立入库
- 合并留给用户用现有 `/merge` 页面手动处理
- YAGNI：自动合并是 Phase 3 检索升级的范围

**E. embedding 生成范围**
- claim 节点：生成 embedding（用于未来检索）
- proposition 节点：**Phase 2 暂不生成**，留到 Phase 3 命题级检索

### 返回值扩展

```python
return {
    "status": "applied",
    "article_node_id": str(article_id),
    "applied": applied,
    "failed": failed,
    # ★ 新增
    "knowledge_nodes_created": {
        "claim": 3,
        "proposition": 12,
        "concept": 2,
    },
    "knowledge_edges_created": 18,
}
```

前端 `ClusteringProposalPage` 在"应用成功"提示里显示这些数字。

## § 3 抽取流程（默认模式切换 + UI 提示）

### 后端改动（最小）

```python
# backend/app/models/schemas.py
class ExtractionMode(str, Enum):
    STANDARD = "standard"
    PROPOSITION = "proposition"   # Phase 2 升为默认推荐

# backend/app/api/extraction.py
@router.post("/extraction/{document_id}/step2")
async def run_step2(
    document_id: str,
    mode: ExtractionMode = ExtractionMode.PROPOSITION,   # ★ 改默认
    db: AsyncSession = Depends(get_db),
):
    ...
```

**防御性默认**：即使前端忘了传 mode，后端也走 proposition。

### 前端 client.ts

```typescript
export async function streamStep2(
  documentId: string,
  onChunk: ...,
  onDone: ...,
  onError: ...,
  mode: 'standard' | 'proposition' = 'proposition',   // ★ 改默认
): Promise<...>
```

### 前端 ExtractionWizardPage UI 改动

**改动 1：state 默认值**
```typescript
const [extractionMode, setExtractionMode] =
  useState<'standard' | 'proposition'>('proposition');   // ★ 改默认
```

**改动 2：UI 文案重写**（去掉"实验性"标签，加路由提示）

```tsx
<div>
  <div>抽取模式</div>
  <div>
    <label>
      <input type="radio" checked={extractionMode === 'proposition'} ... />
      命题化（推荐 · 每个 claim 展开 2-5 个自包含命题，还原度更高）
    </label>
    <label>
      <input type="radio" checked={extractionMode === 'standard'} ... />
      标准（topic + claim + 实体，适合抽象理论文）
    </label>
  </div>
  {/* ★ 新增路由提示 */}
  <div style={{ fontSize: 12, color: '#64748b' }}>
    💡 命题化在新闻/综述/工程类文章上 F1 提升 20-50%；
    高度抽象的理论文（纯数学/纯概念关系）建议用标准模式。
  </div>
</div>
```

**改动 3：radio 顺序调换**——命题化放第一个（默认选中）

### 向后兼容矩阵

| 场景 | 行为 |
|------|------|
| 全新文章抽取 | 走 proposition（新默认） |
| 已有 standard draft graph | 不受影响，仍能编辑/入库 |
| 已有 proposition draft graph（Phase 1 抽的） | 不受影响，能正常入库（Phase 2 后入库会带上 claim/proposition） |
| 前端旧版本（缓存） | 后端默认兜底 proposition |

### 不做的事（YAGNI）

- 不加"自动判断文章类型"逻辑
- 不移除 standard 模式
- 不改 streamStep2 的 URL 结构（保留 `?mode=proposition` 显式参数）

## § 4 全局图 API + 前端下钻（Gap 3）

### 新增后端端点 `/graph/article/{article_id}`

```python
@router.get("/graph/article/{article_id}")
async def get_article_subgraph(
    article_id: str,
    include_proposition: bool = True,   # 可选折叠
    db: AsyncSession = Depends(get_db),
):
    """返回某篇文章的 claim + proposition 子图（含内部边）。"""
    store = GraphStore(db)
    result = await store.get_article_subgraph(
        UUID(article_id), include_proposition=include_proposition
    )
    if not result:
        raise HTTPException(status_code=404, detail="Article not found")
    return result
```

### GraphStore.get_article_subgraph 实现

```python
async def get_article_subgraph(
    self,
    article_id: UUID,
    include_proposition: bool = True,
) -> Optional[dict]:
    """获取 article 节点下属的 claim + proposition + 内部边。

    查询策略：
    1. 通过 article.source_document_id 反查 document_id
    2. 查所有 source_document_id == document_id 的节点
    3. 如果 include_proposition=False，过滤掉 proposition
    4. 查这些节点之间的所有 active edge
    """
    # Step 1
    art = await self.db.execute(
        select(Node.source_document_id).where(Node.id == article_id)
    )
    doc_id = art.scalar_one_or_none()
    if not doc_id:
        return None

    # Step 2
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

    # Step 3
    edges = await self.get_edges_for_nodes(node_ids) if node_ids else []

    return {
        "article_id": str(article_id),
        "document_id": str(doc_id),
        "nodes": [self._node_to_dict(n) for n in nodes],
        "edges": edges,
    }
```

**关键设计点**：
- 基于 `source_document_id` 反查——所有入库的知识节点都带这个字段
- 不依赖 parent_node_id 查询——parent_node_id 只是 proposition 的物理指针，反查走 source_document_id 更高效（已有索引）
- `include_proposition` 参数支持逐级展开

### 前端 GlobalGraphPage 改动

**方案：点击 article 节点 → 右侧滑出下钻面板**

```tsx
const [drillingArticle, setDrillingArticle] = useState<string | null>(null);
const [subGraph, setSubGraph] = useState<GraphData | null>(null);

const handleArticleClick = async (nodeId: string) => {
  if (nodeType !== 'article') return;
  setDrillingArticle(nodeId);
  const data = await getArticleSubgraph(nodeId);
  setSubGraph(convertGraph(data));
};

{drillingArticle && (
  <div style={{
    position: 'absolute', right: 16, top: 16, bottom: 16,
    width: 480, background: '#fff', borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10,
    display: 'flex', flexDirection: 'column',
  }}>
    <div style={{ padding: 12, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
      <span>文章下钻：{articleName}</span>
      <button onClick={() => setDrillingArticle(null)}>✕</button>
    </div>
    <div style={{ flex: 1, position: 'relative' }}>
      <GraphEditor graphData={subGraph} editable={false} />
    </div>
  </div>
)}
```

### proposition 节点展示规则

复用 Phase 1 已有样式：
- claim 节点：蓝色（现有）
- proposition 节点：浅紫色（Phase 1 已加）
- proposition description 多行显示
- 默认布局：claim 居中，proposition 围绕其 parent claim 散开

### 全局宏观图不变

`/graph/global?filter_type=all` 仍只返回 topic + article。下钻按需加载，单次请求只查一篇文章（20-50 节点），不拖慢首屏。

### 新增 API client

```typescript
export async function getArticleSubgraph(
  articleId: string,
  includeProposition = true,
): Promise<{ article_id: string; document_id: string; nodes: any[]; edges: any[] }> {
  const url = `/api/graph/article/${articleId}?include_proposition=${includeProposition}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

## § 5 ClusteringService 适配边界（Gap 5）

**当前状态**：`ClusteringService.apply_proposal` + `ClusteringPlanner.generate_proposal` 只处理 topic（tag_actions），完全没碰 claim/proposition。

**Phase 2 边界明确**：

| 范围 | 做不做 | 理由 |
|------|--------|------|
| `apply_proposal` 把 claim/proposition 入库 | ✅ 做 | § 2 详述，这是 Phase 2 核心 |
| `ClusteringPlanner` 为 claim/proposition 生成合并建议 | ❌ 不做 | 跨文 claim 合并是检索优化，留 Phase 3 |
| InsertionProposal.proposal_json 新增 claim_actions 字段 | ❌ 不做 | YAGNI，避免前端 UI 改动过载 |
| `/merge` 页面支持 proposition 类型 | ❌ 不做 | 现有 merge 按 topic 走，扩展复杂度高且价值低 |

**"适配"的具体含义**：让 `apply_proposal` 正确处理 proposition 模式的 draft graph（不报错、不漏节点、temp_id 正确翻译）；让 `ClusteringPlanner.generate_proposal` 不被 proposition 节点干扰（topic 聚合仍按 `topic_tags` 走）。

## § 6 测试策略

### 1. Migration 测试

```bash
python scripts/migrate_phase2.py           # 第一次跑：创建字段
python scripts/migrate_phase2.py           # 第二次跑：idempotent，不报错
psql -c "\d nodes" | grep parent_node_id   # 验证字段存在
psql -c "SELECT count(*) FROM nodes WHERE parent_node_id IS NOT NULL"
# 应返回 0（迁移前没有 proposition 入库）
```

### 2. 单元测试（pytest）

新增 `backend/tests/test_phase2_apply.py`：

```python
async def test_apply_proposal_with_proposition_mode():
    """proposition draft graph 入库后，claim + proposition 进 Node 表"""

async def test_apply_proposal_backward_compatible_standard():
    """standard draft graph 入库仍正常（顺带修复 claim 丢失）"""

async def test_get_article_subgraph():
    """下钻端点返回正确子图"""
```

### 3. 端到端冒烟测试（手工）

```bash
# 1. 重启后端
# 2. 导入新文章
# 3. 默认走 proposition 模式抽取（验证 § 3）
# 4. 确认入库（验证 § 2 claim/proposition 落库）
# 5. 打开 /graph 全局图，点 article 节点（验证 § 4）
# 6. 确认下钻面板显示 claim + proposition 子图
```

### 4. 回归测试

- 现有 standard 模式 draft graph：确认仍能编辑/入库
- 现有入库数据：确认 `/graph/global` 仍只显示 topic+article，节点数不爆炸
- 评估实验室：确认 `/eval` 4 策略对比仍正常工作

### 5. 性能验证

- 下钻端点响应时间：单篇文章 20-50 节点，<200ms
- 入库时间：proposition draft vs standard draft，差应 <2x

## § 7 风险与回退

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| migration 在生产数据上失败 | 低 | 高 | IF NOT EXISTS 幂等 + 部分索引 + 测试库先跑 |
| apply_proposal 入库时 temp_id 映射出错（dangling edge） | 中 | 中 | 入库前校验所有 edge 的 source/target 在映射表里；失败回滚事务 |
| default 改 proposition 后，用户被旧 session 缓存卡住 | 低 | 低 | 后端 API 默认也改，双重兜底 |
| 下钻子图节点过多（>100）拖慢前端 | 低 | 低 | include_proposition 默认折叠；后端 LIMIT 兜底 |
| 前端 GlobalGraphPage 浮层与现有面板布局冲突 | 中 | 低 | 浮层用 absolute 定位，独立于左侧 panel |

### 回退方案

**数据层回退**（紧急）：用 feature flag 包起来。

```python
PHASE2_KNOWLEDGE_INGEST = os.getenv("PHASE2_KNOWLEDGE_INGEST", "true")
# 紧急时设 false，回到 Phase 1 行为（claim/proposition 仍不入库）
```

**API 层回退**：`ExtractionMode` 默认改回 `STANDARD`（一行代码）。

**前端回退**：`extractionMode` state 默认改回 'standard'；下钻浮层用 `ENABLE_DRILLDOWN` feature flag 包起来。

**不可逆操作清单**：
- `parent_node_id` 字段一旦加上不删除（向后兼容，旧代码不碰它）
- 已入库的 proposition 节点保留在 Node 表（可批量 DELETE WHERE node_type='proposition' 清理）

### Feature Flag 建议

```bash
# .env
PHASE2_DEFAULT_PROPOSITION=true      # 默认模式切换
PHASE2_KNOWLEDGE_INGEST=true         # claim/proposition 入库
PHASE2_DRILLDOWN_UI=true             # 下钻面板
```

任何一个出问题，单独关闭不影响其他。

## 关键决策记录

1. **范围**：完整闭环（修 Gap 1-5），让命题真正进入全局图。Phase 1 质量优势才能落地。
2. **模式路由**：手动切换 + 提示。默认改 proposition，UI 文案明确"抽象理论文用 detailed"。不引入自动路由（YAGNI）。
3. **父子关系存储**：加 `parent_node_id` 字段（非复用 Edge.contains）。专为父子层级语义，查询高效。
4. **全局图展示**：宏观图 + 下钻。`/graph/global` 保持 topic+article，新增 `/graph/article/{id}` 按需返回 claim+proposition 子图。避免节点爆炸。
5. **入库范围**：claim + proposition 都入库。顺带修复 standard 模式 claim 丢失的 bonus 问题。
6. **不做自动合并**：跨文 claim 合并留给 Phase 3 检索升级和现有 `/merge` 手动页面。
7. **embedding 范围**：claim 生成 embedding（保持现有行为），proposition 暂不生成（Phase 3 范围）。
8. **Feature flag 三层**：默认模式、入库、下钻 UI 独立可控，任一出问题可单独关闭。
