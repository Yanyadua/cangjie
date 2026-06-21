# 径向知识图谱视图改造设计

> **目标**：把现有 `/graph` 路由（GlobalGraphPage）改造为以「我」为中心的径向 4 层层级视图。

## 背景

当前 `/graph` 路由是一个通用的图谱浏览器：默认显示所有 topic + article 节点（不含 person/partition），点击节点会加载 1-hop 邻居替换整个画布。这种"搜索式探索"模式无法体现项目的核心设计意图——**以个人为中心、4 层严格层级（person → partition → topic → article）**。

设计意图（见 CLAUDE.md「关键设计决策 → 全局知识图谱严格 4 层层级」）：

- L0 `person ("我")` — 图谱核心
- L1 `partition` — 个人延伸出的所有领域分区（边 `person --root--> partition`）
- L2 `topic` — 每个分区下的主题（边 `topic --part_of--> partition`，每个 topic 必挂一个 partition）
- L3 `article` — 每个主题下的文章（边 `article --tag--> topic`，文章只通过 topic 接入层级）
- 横向 `topic --related_to/contains--> topic` 是 L2 内的语义关联

## 设计决策

### 布局形态：径向扇区

**圆心**：person「我」（金色 `#fbbf24`，最大圆形）
**第一圈**：partitions，半径 R1，圆周均分。每个分区占一个扇区（angle = 2π / partition_count）
**第二圈**：topics，每个分区下的主题在所属扇区内、半径 R2 上排列
**第三圈**：articles，从主题辐射出去的短线，半径 R3。默认收起，点击 topic 时展开

**为什么按扇区切分**：分区归属一目了然，分区之间不会节点重叠，比力导向布局更稳定可读。

### 节点样式

复用现有 `nodeColorVar` 配色，4 层用尺寸 + 颜色区分：

| 层级 | 类型 | 形状 | 尺寸 | 颜色 |
|---|---|---|---|---|
| L0 | person | 圆形 | 80px | `#fbbf24` 金 |
| L1 | partition | 圆角矩形 | 160×60 | `#6366f1` 紫 |
| L2 | topic | 圆角矩形 | 120×50 | `NODE_COLORS[topic]` |
| L3 | article | 小圆点/小卡 | 80×30 | `#3b82f6` 蓝 |

收起状态下，topic 节点显示数字徽章「N 篇文章」。

### 数据源

**复用现有端点**：`GET /graph/global?filter_type=partition`

研究确认 `app/api/graph.py:51-62` 中 `filter_type=partition` 分支返回完整的 4 层节点（`person`、`partition`、`topic`、`article`）+ 所有边。**无需新增后端端点**。

前端类型层面：不修改 `types/graph.ts`（GraphNode 已含 `nodeType` 联合类型，足够推断层级）。不修改 `graph-mappers.ts`（`mapWireNode` 丢弃 `parent_node_id` 没关系，客户端按 `nodeType` + 边关系即可重建树）。

### 交互模型

| 操作 | 行为 |
|---|---|
| 点击 topic | 切换该主题的文章展开/收起。展开时文章从 topic 沿径向辐射到 R3 |
| 点击 partition | 高亮该分区的所有节点，其他节点 opacity 降到 0.2 |
| 点击 article | 右侧 Sheet 打开，显示详情 + 文章内部子图（复用现有 `getArticleSubgraph` + `<GraphEditor>` 渲染） |
| 点击 person | 取消所有高亮，恢复默认视图 |
| 搜索框输入 | 实时按节点名匹配；匹配节点高亮+居中，未匹配的淡化 |

**关键差异**：**不再**用现有 `handleNodeClick` 那种"加载 1-hop 邻居替换整个画布"的行为。径向布局是静态的层级展示，交互只改变可见性/高亮，不重新加载图数据。

### 默认状态

进入页面：
- 「我」在中心
- 分区呈环状展开（第一圈）
- 主题展开（第二圈）
- **文章收起**（topic 上显示「N 篇文章」徽章）
- 自动 `fitView` 适配画布

### 顶部控件

- **保留**：搜索框（左侧）
- **移除**：「全部/主题/文章/分区」过滤按钮 + filterCounts（径向布局本身已是完整层级，按钮只会破坏布局）
- **新增**（可选）：右上角小图例，说明 4 个层级的颜色对应

### 空状态

如果还没有 partition：`<EmptyState>`「你的知识图谱还是空的」+ 按钮跳 `/import`。

### 组件结构

```
pages/GlobalGraphPage.tsx                  ← 改造（路由不变）
  ├── RadialKnowledgeGraph.tsx             ← 新建（核心径向布局组件）
  │   ├── useRadialLayout() hook           ← 计算各节点位置
  │   └── 渲染 ReactFlow + 自定义节点
  ├── components/ui/sheet (复用)            ← 文章详情侧边栏
  ├── GraphEditor (复用)                    ← 文章子图预览（Sheet 内）
  └── Input, Card, Alert, EmptyState (复用)
```

**关键决策：新建 `RadialKnowledgeGraph` 而非扩展 `GraphEditor`**。原因：
- `GraphEditor` 当前用 dagre（分层有向图），dagre 不支持径向
- 径向布局是纯几何计算（角度 + 半径），不需要通用图布局算法
- 不污染 `GraphEditor`，后者继续用于文章子图等其他场景
- MEMORY.md 标注 `GraphEditor` 为 OFF-LIMITS，避免改它

### 布局算法（核心数学）

```typescript
// 伪代码
const R1 = 200, R2 = 400, R3 = 580;  // 三圈半径

function layoutRadial(nodes, edges) {
  const person = nodes.find(n => n.nodeType === 'person');
  const partitions = nodes.filter(n => n.nodeType === 'partition');
  const topics = nodes.filter(n => n.nodeType === 'topic');
  const articles = nodes.filter(n => n.nodeType === 'article');

  // person 固定圆心
  position(person, 0, 0);

  // partitions 在 R1 圆周上均分
  partitions.forEach((p, i) => {
    const angle = (i / partitions.length) * 2 * Math.PI;
    position(p, R1 * cos(angle), R1 * sin(angle));
  });

  // topics 按所属 partition 分组，在扇区内排列
  partitions.forEach((partition, pi) => {
    const sectorStart = (pi / partitions.length) * 2 * Math.PI;
    const sectorEnd = ((pi + 1) / partitions.length) * 2 * Math.PI;
    const topicsInPartition = topics.filter(t => getParent(t, edges) === partition.id);
    topicsInPartition.forEach((t, ti) => {
      const angle = sectorStart + ((ti + 0.5) / topicsInPartition.length) * (sectorEnd - sectorStart);
      position(t, R2 * cos(angle), R2 * sin(angle));
    });
  });

  // articles 仅在展开时计算位置
  // (按所属 topic 分组，在 topic 周围短距离辐射)
}
```

### 错误处理

- 加载失败：`<Alert variant="destructive">` + 重试按钮（沿用现有模式）
- 空状态：`<EmptyState>` 引导导入
- 单个 article 子图加载失败：Sheet 内显示降级提示，不阻塞主视图

## 验收标准

1. 进入 `/graph`，看到「我」在中心，周围环绕分区，再外一圈主题，文章默认收起
2. 点击任一 topic，该 topic 下的文章从 topic 辐射展开；再次点击收起
3. 点击 partition，该分区高亮其他淡化
4. 点击 article，右侧 Sheet 打开显示文章内部子图
5. 搜索框输入节点名，匹配的节点高亮居中
6. 「全部/主题/文章/分区」过滤按钮消失
7. 侧边栏文案更新（"全局图谱" → 体现"以个人为核心"的措辞）
8. `npm run build` 通过

## 不在本次范围

- 后端新增专用 `/graph/me/hierarchy` 端点（YAGNI，复用现有即可）
- 清理 `article --belongs_to--> partition` 冗余边（已在 CLAUDE.md 标记为待清理，单独任务）
- 性能优化（虚拟化、WebGL 渲染）—— 等规模上来再说
- 移动端适配

## 风险

1. **节点规模上限**：当 partition × topic × article 数量大时（比如 5×20×10=1000 节点），径向布局可能拥挤。当前缓解：文章默认收起，只展示 L0-L2（约 1+5+20=26 节点）。
2. **React Flow 性能**：1000 节点 React Flow 会卡。如果实际使用中遇到，再考虑分页/聚类。
3. **扇区角度过窄**：单分区下 topic 数极多时（>30），扇区内排列会拥挤。当前缓解：不硬限，让用户自然感知"该拆分区了"。
