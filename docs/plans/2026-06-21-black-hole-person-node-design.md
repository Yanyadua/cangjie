# 黑洞 UI 中心节点设计

> **目标**：把径向图谱中心的 person 节点改造成真实黑洞视觉（吸积盘 + 事件视界 + 光晕），同时修复后端 person 节点缺失与 partition 孤悬 bug。

## 背景

径向图谱（`/graph`）上线后用户反馈看不到 person 节点。诊断结论：

- `init_db.py` 不 seed person，`/graph/global` 端点不调 `ensure_me_node()`
- person 只在 `ClusteringService.apply_proposal` / `PartitionService.create_partition` / `MergeService` 三条路径懒创建
- `MATCH` partition_action 只创建 person，不建 `person --root--> partition` 边 → 分区孤悬

用户希望中心节点做成「黑洞」UI 作为个人身份的视觉象征。

## 设计决策

### 视觉风格：真实吸积盘（方案 B 分层光晕）

参考 EHT 2019 黑洞照片。三层 div 结构：

| 层 | 类名 | 尺寸 | 实现 |
|---|---|---|---|
| 外层光晕 | `.halo` | 120×120 | `radial-gradient` 金→橙→深紫 + `filter: blur(8px)` |
| 旋转吸积盘 | `.disk` | 80×80 | `conic-gradient` 旋臂 + `@keyframes spin 30s linear infinite` |
| 事件视界 | `.horizon` | 40×40 | 纯黑实心 + `box-shadow` 内陷感 |

**容器尺寸**：120×120（比原 80×80 大 50%，确保视觉焦点）

**颜色序列**：
- `#fbbf24` 金（`--node-person` light）
- `#e8943b` 橙（`--accent`）
- `#4c1d95` 深紫

**动效**：吸积盘 30s 一圈缓慢旋转

**无文字标签**：事件视界即身份象征，不再叠加"我"字（原 PersonNode 显示 label）

**dimmed 状态**：整体 `opacity: 0.2`，与其他节点保持一致

### 后端修复

#### 修复 1：`/graph/global` 端点懒创建 person

`backend/app/api/graph.py` 的 `filter_type=partition` 分支，在取数前调用：

```python
graph_store = GraphStore(db)
me_id = await graph_store.ensure_me_node()
await graph_store.attach_orphan_partitions(me_id)  # 见修复 3
await db.commit()
```

#### 修复 2：MATCH partition_action 也建 root 边

`backend/app/services/clustering_service.py` 的 MATCH 分支，调用 `ensure_me_node()` 后检查并创建 `root` 边（若不存在）。

#### 修复 3：`attach_orphan_partitions()` 存量修复

新增 `GraphStore.attach_orphan_partitions(me_id)` 方法：

- 扫描所有 `node_type='partition'` 且无 `root` 入边的节点
- 为每个孤悬 partition 建 `person --root--> partition` 边
- 在 `/graph/global?filter_type=partition` 端点开头调用一次

这样所有存量 partition（包括 DB 里之前 MATCH 模式创建的孤悬分区）都会立刻挂到中心。

### 前端改造

**单文件改动**：`frontend/src/components/RadialKnowledgeGraph.tsx`

`PersonNode` 函数（当前 24-40 行）整体重写为三层 div 结构：

```tsx
function PersonNode({ data }: NodeProps<Node<RadialNodeData>>) {
  return (
    <div
      onClick={data.onSelect}
      className="black-hole"
      style={{ opacity: data.dimmed ? 0.2 : 1 }}
    >
      <div className="black-hole__halo" />
      <div className="black-hole__disk" />
      <div className="black-hole__horizon" />
    </div>
  );
}
```

**CSS**：放在 `frontend/src/styles/globals.css`，与现有设计 token 一致。用 `@keyframes spin` 而非 Tailwind 动画类（Tailwind 没有 30s 旋转内置）。

### 点击交互

保持不变。person 点击仍触发 `handleNodeClickInternal` 的 `level === 0` 分支：
- 清空 `expandedTopicIds`
- 清空 `highlightedPartitionId`

黑洞旋转动画不受点击影响。

## 组件结构

```
pages/GlobalGraphPage.tsx                       ← 不变
  └── RadialKnowledgeGraph.tsx                  ← 改 PersonNode
        └── PersonNode (三层 div + CSS 动画)     ← 重写

backend/
  ├── app/api/graph.py                          ← 改 filter_type=partition 分支
  ├── app/core/graph_store.py                   ← 新增 attach_orphan_partitions()
  └── app/services/clustering_service.py        ← 改 MATCH 分支建 root 边

frontend/src/styles/globals.css                 ← 加 .black-hole 样式
```

## 验收标准

1. 进入 `/graph`，即使 DB 里原本没有 person，也能立刻看到中心黑洞
2. 黑洞由三层组成：发光光环（金→橙→紫渐变 + blur） + 旋转吸积盘（conic-gradient 30s/圈） + 黑色事件视界
3. 吸积盘视觉上能感知到缓慢转动
4. MATCH 模式新建的 partition 会挂到 person 下（root 边存在）
5. DB 里存量孤悬 partition（之前 MATCH 创建的）也会挂到 person 下
6. `dimmed` 状态下黑洞整体 opacity 降到 0.2
7. 点击黑洞仍触发重置（清空展开 + 清空高亮）
8. `npm run build` 通过
9. 后端单测（如有）通过

## 不在本次范围

- 引力透镜效果（需 WebGL/Canvas，YAGNI）
- 黑洞"吞噬"动画（点击 partition 时被吸入，视觉炫但实现重）
- 节点拖拽（React Flow 默认支持，无需改）
- `article --belongs_to--> partition` 冗余边的彻底清理（已在 CLAUDE.md 标记，单独任务）

## 风险

1. **CSS `filter: blur` 性能**：单节点 blur(8px) 影响微乎其微。如果后续有多个黑洞（不太可能），再优化。
2. **端点额外查询**：`attach_orphan_partitions` 每次访问 `/graph/global` 会多一次 `SELECT partitions LEFT JOIN edges` 查询。partition 数量级通常 < 20，开销可忽略。
3. **React Flow 节点尺寸 120×120**：比其他节点大，fitView 默认 padding 0.2 可能不够，实际跑起来看效果再调。
