# 命题级知识抽取设计文档

> **目标：** 把图谱从"标签集合"升级为"自包含事实集合"，使图谱喂给 LLM 能还原原文 70%+，而不只是关键词列表。

## 核心问题

当前抽取产物做不到"图谱→还原原文"，三个信息损失点：

| 问题 | 现状 | 后果 |
|------|------|------|
| **粒度粗** | 3-5 个核心 claim 节点 | 丢 90%+ 细节 |
| **叙事结构扁平** | claim 平铺成无序列表 | 论证链、章节结构消失 |
| **description 是标签** | "GraphRAG 通过社区汇总解决全局问题" | 缺数据/条件/引用，无法独立理解 |

## 学术依据

### Tree-KG (ACL 2025)
核心原则：**"先显式化结构，再隐式填充缝隙"**
- 树状骨架：TOC → 小节 → 上下文
- 模拟人类学习路径（先看大纲再深入细节）
- 局部上下文是必需品，不是可选项

### Dense X Retrieval (EMNLP 2024)
核心单元：**命题 = 原子、自包含、唯一的语义单元**
- 三性：unique（含义唯一）/ atomic（不可再分）/ self-contained（含所有必要上下文）
- 反例：「GraphRAG 优于传统 RAG」（缺数据集和指标）
- 正例：「在 MultiHop-RAG 数据集上，GraphRAG 的 F1=0.73，比传统 RAG 高 15 个百分点」
- 在 retrieval 任务上 Recall@5 提升 17-25%

## 方案概览：树骨架 + 命题叶

一句话：**用 Tree-KG 给图谱加层级骨架，用 Dense X 给叶节点补命题密度**。

当前系统已是两阶段（skeleton → expand），改进是**增强**这两个阶段，不是推倒重来。

```
原文
 │
 ▼
Stage 1 骨架（Tree-KG 化）
 │  树状论证地图：
 │  article
 │  ├── section: "方法"
 │  │   ├── claim: "GraphRAG 用社区汇总解决全局问题"
 │  │   └── claim: "两阶段抽取保证准确率"
 │  └── section: "实验"
 │      ├── claim: "MultiHop-RAG 上 F1=0.73"
 │      └── claim: "比传统 RAG 高 15pp"
 ▼
Stage 2 展开（命题化）
   每个 claim → 3-7 个自包含命题：
   "F1=0.73" claim 下：
   ├── proposition: "在 MultiHop-RAG 数据集上，GraphRAG 的 F1=0.73（论文表3）"
   ├── proposition: "该数据集包含 2023 年新闻的多跳推理问题"
   └── proposition: "对比基线传统 RAG F1=0.58"
```

## Stage 1 骨架改进：Tree-KG 化

### 现状
```json
{
  "summary": "...",
  "topic_tags": ["GraphRAG", "RAG", "知识图谱"],
  "core_claims": ["claim1", "claim2", "claim3"]  // 平铺
}
```

### 改进
```json
{
  "summary": "...",
  "topic_tags": ["GraphRAG", "RAG", "知识图谱"],
  "structure": [
    {
      "temp_id": "sec_method",
      "node_type": "section",
      "name": "方法",
      "claims": [
        {"temp_id": "c1", "node_type": "claim", "name": "GraphRAG 用社区汇总解决全局问题"},
        {"temp_id": "c2", "node_type": "claim", "name": "两阶段抽取保证准确率"}
      ]
    },
    {
      "temp_id": "sec_exp",
      "node_type": "section",
      "name": "实验",
      "claims": [
        {"temp_id": "c3", "node_type": "claim", "name": "MultiHop-RAG 上 F1=0.73"}
      ]
    }
  ]
}
```

**章节节点弱化原则**：仅在多级章节明显的文章（论文/长报告）使用；短文（<1500 字或无明显章节）直接平铺 claim，跳过 section 层级。

## Stage 2 展开改进：命题化

### 现状
```json
{
  "temp_id": "c3",
  "node_type": "claim",
  "name": "MultiHop-RAG 上 F1=0.73",
  "description": "GraphRAG 在 MultiHop-RAG 上达到 F1=0.73"  // 标签式
}
```

### 改进（每个 claim 下展开 3-7 个命题）
```json
[
  {
    "temp_id": "p1",
    "node_type": "proposition",
    "name": "GraphRAG 在 MultiHop-RAG 上 F1=0.73",
    "description": "在 MultiHop-RAG 数据集上，GraphRAG 的 F1 达到 0.73，比传统 RAG 高 15 个百分点（论文表3）",
    "parent_claim_id": "c3",
    "metadata": {
      "data_points": ["F1=0.73", "+15pp"],
      "conditions": ["MultiHop-RAG dataset"],
      "citations": ["表3"]
    }
  },
  {
    "temp_id": "p2",
    "node_type": "proposition",
    "name": "MultiHop-RAG 数据集包含 2023 年新闻多跳问题",
    "description": "MultiHop-RAG 数据集包含 2023 年新闻的多跳推理问题，用于评估 RAG 系统在多步推理上的能力",
    "parent_claim_id": "c3"
  },
  {
    "temp_id": "p3",
    "node_type": "proposition",
    "name": "传统 RAG 在 MultiHop-RAG 上 F1=0.58",
    "description": "作为对比基线，传统 RAG 在 MultiHop-RAG 数据集上的 F1 仅为 0.58",
    "parent_claim_id": "c3"
  }
]
```

命题之间用现有边类型连接：
- `evidence_for`: proposition → claim
- `supports` / `contradicts`: proposition → claim（立场）
- `causes` / `derived_from` / `compares_with`: proposition → proposition（推理链）

## 节点类型扩展

`backend/app/models/schemas.py` 的 `NODE_TYPES` 列表新增：
- `proposition` — 自包含原子事实
- `section` — 章节分组容器（弱化使用）

`core/graph_extractor.py` 的 `VALID_NODE_TYPES` 同步新增。

`frontend/src/types/graph.ts` 的 `NodeType` 联合类型新增 `'proposition' | 'section'`，`NODE_COLORS` 加颜色（proposition 用浅紫，section 用灰）。

## 抽取 Prompt 设计

### Skeleton Prompt（增加章节结构指令）

```
你是知识图谱抽取助手。请从文章中提取：

1. summary: 3-5 句文章概要
2. topic_tags: 3-8 个主题标签
3. structure: 如果文章有清晰章节结构（论文/长报告），
   按章节分组组织 claim；否则所有 claim 平铺在一个名为"主体"的 section 下。
   每个 section 包含 1-5 个 claim。
   每个 claim 是一个完整的事实陈述（10-20字），不是关键词。
```

### Expand Prompt（命题化）

```
对每个 claim 节点，展开 3-7 个命题节点（proposition）。
命题三性要求：
- unique: 每个命题含义唯一，不与其他命题重叠
- atomic: 不可再分为更小的独立事实
- self-contained: 包含所有必要上下文（数据、条件、引用、主语）

正例: "在 MultiHop-RAG 数据集上，GraphRAG 的 F1=0.73（论文表3）"
反例: "GraphRAG F1 很高"（缺数据集和具体值）

每个命题必须：
- 包含具体的数字、名称、条件（如果原文有）
- 在 description 字段中给出完整自包含的事实陈述
- 在 evidence 字段中引用原文片段
- 在 metadata.data_points 中列出关键数据点

命题之间用 evidence_for / supports / causes 等边连接，
还原原文的论证链条。
```

### 验证规则（`_validate_and_sanitize`）

新增校验：
- `proposition` 节点必须有 `description`（≥30 字，防止标签化）
- `proposition` 节点必须有 `parent_claim_id`
- 命题数量上限：单 claim 下 ≤10 个，防止爆炸

## API 改动

### 新增 extraction_mode 参数

`POST /extraction/{document_id}/step2` 和 `GET /extraction/{document_id}/step2/stream` 增加查询参数：

```
?extraction_mode=standard   # 当前默认（向后兼容）
&extraction_mode=proposition  # 新增命题化模式
```

### 端点契约

```python
class ExtractionMode(str, Enum):
    STANDARD = "standard"        # 现状
    PROPOSITION = "proposition"  # 新增

@router.post("/extraction/{document_id}/step2")
async def run_step2(
    document_id: str,
    mode: ExtractionMode = ExtractionMode.STANDARD,
    db: AsyncSession = Depends(get_db),
):
    ...
```

## 前端改动

### ExtractionWizardPage

Step 2 触发按钮旁加模式切换：
```
[○ 标准] [● 命题化（更详细）]
[ 确认骨架并展开图谱 ]
```

### DraftGraphPage 展示命题节点

- 命题节点用浅紫色（区别于 claim 的蓝色）
- 默认折叠（claim 节点点击展开下属命题），避免视觉爆炸
- 切换"展开全部命题"按钮

### GraphEditor 适配

- 节点类型 `proposition` / `section` 的样式
- 章节节点不显示文字框，只显示分组容器
- Proposition 节点显示 description 全文（多行）

## A/B 实验：复用评估实验室

`/eval` 页面（EvaluationLabPage）已支持多策略对比。**新增第四个策略档位**：

| 档位 | 实现 | 预期节点数 |
|------|------|-----------|
| 简洁 | `concise`（现有） | 5-8 |
| 标准 | `standard`（现有） | 8-15 |
| 详细 | `detailed`（现有） | 15-25 |
| **命题化** | `proposition` mode（新增） | 30-80 |

### 还原度专项指标

复用现有评估流程，但新增更严格的指标：

| 指标 | 计算方式 |
|------|----------|
| ROUGE-L | 重建文本 vs 原文的字符级重叠 |
| 命题覆盖率 | 关键事实点（数据/名称/条件）的命中率 |
| LLM-as-judge | 5 分制评分（叙事流畅性 + 数据准确性 + 完整性） |
| 信息密度 | 节点数 / 文章字数（防止注水） |

### 实验脚本

`backend/scripts/proposition_ab_test.py`：
1. 输入 document_id
2. 调用两次 step2（standard / proposition）
3. 调用评估器生成对比报告
4. 输出到 stdout + 保存 JSON

## 实施路线

### Phase 1：实验验证（不改主流程）

**目标**：验证命题化能显著提升还原度，数据决定是否进 Phase 2。

**任务清单**：
- [ ] `NODE_TYPES` 加 `proposition` / `section`
- [ ] `GraphExtractor` 新增 `_EXPAND_PROPOSITION_SYSTEM` prompt
- [ ] `run_expand()` 增加 `mode` 参数（默认 standard）
- [ ] `ExtractionService` 透传 mode 参数
- [ ] `/extraction/{id}/step2` 和 `/step2/stream` 增加 `mode` 查询参数
- [ ] 前端 `streamStep2` 支持 mode 参数
- [ ] ExtractionWizardPage 加模式切换 UI
- [ ] DraftGraphPage / GraphEditor 适配新节点类型展示
- [ ] 评估实验室加"命题化"档位
- [ ] 跑 1-3 篇真实文章的 A/B 对比实验
- [ ] **决策门**：还原度提升 ≥20% 才进 Phase 2

**风险**：低。所有改动加在 mode 参数背后，默认行为完全不变。

### Phase 2：集成（确认 Phase 1 有效后）

**目标**：让命题化成为默认，融入聚类/检索。

- [ ] 默认 mode 改为 `proposition`
- [ ] `ClusteringService` 适配：topic 节点聚合到 claim 层级（不下钻到 proposition）
- [ ] `/graph/global` 过滤规则：默认只显示 topic + article + claim，proposition 折叠
- [ ] 全局图导航：点击 claim 节点 → 展开 proposition 子图
- [ ] 命题节点入库：Node 表新增 `parent_node_id` 字段

### Phase 3：检索升级

**目标**：用命题作为检索单元，提升 QA 准确率。

- [ ] 命题级 chunk embedding（替代或补充当前 chunk）
- [ ] `SearchService` 命题检索路径
- [ ] `QAService` 上下文构建优先用命题（含完整自包含事实）
- [ ] 评估 QA 任务准确率提升

## 关键风险与缓解

| 风险 | 缓解 |
|------|------|
| 命题数量爆炸，图谱不可读 | 单 claim ≤7 命题硬上限 + 前端折叠 |
| LLM 生成命题质量不稳定 | 强制校验：description ≥30 字 + metadata.data_points 非空 |
| 现有聚类/合并逻辑被打破 | Phase 2 才动聚类，先在 Phase 1 隔离验证 |
| 还原度测试本身主观 | 三指标组合：ROUGE-L（客观）+ 命题覆盖率（客观）+ LLM-judge（主观） |
| API 兼容性 | mode 参数默认 standard，零破坏 |

## 关键决策记录

1. **改造方式**：新增 `extraction_mode` 参数，默认 `standard`，A/B 实验后再切默认
2. **命题粒度**：单 claim 下 3-7 个 proposition（平衡密度和规模）
3. **章节节点**：弱化使用，仅在多级章节明显的文章才用
4. **实验时机**：先写完设计文档（本文档）→ 实施 Phase 1 → A/B 实验 → 决策门

## 参考

- [Tree-KG: Knowledge Graphs with Tree-Based Hierarchical Structure (ACL 2025)](https://aclanthology.org/2025.acl-long.907.pdf)
- [Dense X Retrieval: What Retrieval Granularity Should We Use? (EMNLP 2024)](https://arxiv.org/html/2312.06648v2)
- [Tree-KG 解读 (Medium)](https://medium.com/ai-exploration-journey/building-smarter-knowledge-graphs-with-tree-kg-7dc93b9e8dc6)
- [Dense X 解读 (Weaviate)](https://weaviate.io/papers/paper10)
