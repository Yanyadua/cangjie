# 图谱质量评估实验室设计文档

> **目标：** 通过 A/B 对比不同抽取策略的图谱质量，用信息重建法评估拆解效果，指导抽取逻辑优化。

## 核心思路

让 AI 模拟人类阅读图谱：从图谱逆向重建知识点，对比原文的 ground truth 知识点，量化图谱的"信息保真度"。

## 评估流程

```
用户选文章 + 勾选策略档位
         │
         ▼
① 原文 ──→ LLM 提取 ground truth 知识点（5-10条，只做一次）
         │
         ▼
② 对每个勾选的策略：
   原文 ──→ [策略X参数重新抽取] ──→ 图谱X
   图谱X ──→ [LLM只看图谱重建知识点] ──→ 重建X
         │
         ▼
③ Ground Truth vs 重建X ──→ LLM 对比评分 ──→ 分数X
         │
         ▼
④ 展示对比表格 + 每个策略的丢失/编造详情
```

## 策略档位

三个预设档位，通过 `temperature` + `prompt 追加指令` 区分：

| 档位 | temperature | prompt 追加指令 | 预期节点数 |
|------|-------------|----------------|-----------|
| **简洁** | 0.1 | "只提取文章最核心的主题和主张，忽略次要实体。目标 5-8 个节点" | 5-8 |
| **标准** | 0.3 | 无追加（当前默认策略） | 8-15 |
| **详细** | 0.6 | "尽可能详细展开，包括次要概念、具体工具和方法。目标 15-25 个节点" | 15-25 |

每个档位走完整两阶段（skeleton → expand），保证可比性。

## 评分维度

| 指标 | 含义 | 计算方式 |
|------|------|----------|
| **召回率** | ground truth 知识点中有多少能从图谱恢复 | matched / len(ground_truth) |
| **准确率** | 图谱重建的知识点有多少是真实的 | matched / len(reconstructed) |
| **F1** | 综合分 | 2×P×R/(P+R) |
| **结构指标** | 节点数、边数、孤立节点数、有 evidence 边占比 | 直接统计 |

对比评分由 LLM 完成（语义等价判断），输出三类：
- `matched`：匹配成功
- `missed`：图谱丢失的
- `hallucinated`：图谱编造的

## 后端架构

### 新增文件

| 文件 | 职责 |
|------|------|
| `core/graph_evaluator.py` | 评估核心：ground truth 提取、图谱重建、对比评分 |
| `services/evaluation_service.py` | 编排层：按策略档位调用抽取 + 评估 |
| `api/evaluation.py` | API 端点 |

### GraphExtractor 改造

`run_skeleton()` 和 `run_expand()` 的 LLM 调用增加：
- `temperature` 参数（当前硬编码 0.3）
- 可选的 `extra_instruction` 追加到 system prompt 末尾

### API 端点

```
POST /api/evaluation/run
  请求: { document_id: str, strategies: ["concise", "standard", "detailed"] }
  响应: {
    ground_truth: ["知识点1", "知识点2", ...],
    results: [
      {
        strategy: "concise",
        graph: { nodes: [...], edges: [...] },
        reconstructed: ["重建知识点1", ...],
        scores: {
          recall, precision, f1,
          node_count, edge_count,
          isolated_nodes, evidence_coverage
        },
        matched: [{gt: "...", reconstructed: "..."}],
        missed: ["未恢复的知识点"],
        hallucinated: ["图谱编造的知识点"]
      }
    ]
  }
```

### LLM Prompt 设计

**Ground truth 提取：**
给 LLM 原文，提取 5-10 条一句话知识点。

**图谱重建：**
只给 LLM 图谱 JSON（不给原文），列出能领会的知识点。

**对比评分：**
给 LLM 两组知识点，语义等价判断，输出 matched/missed/hallucinated + recall/precision。

ground truth 只提取一次，所有策略共享。

## 前端设计

**`EvaluationLabPage.tsx`** — 单页面完成全部操作：

1. **选文章**：下拉选择器
2. **选策略档位**：复选框（简洁/标准/详细），默认全选
3. **Ground Truth 展示**：评估完成后显示
4. **评分对比表**：三列并排，颜色高亮（<60% 红，>85% 绿）
5. **差异详情**：可折叠展开，显示丢失/编造的知识点
6. **图谱预览**：复用 GraphEditor 组件（只读），可切换版本

运行时显示进度状态（多次 LLM 调用）。

导航栏新增"评估"入口。
