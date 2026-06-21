# 径向知识图谱视图 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `/graph` 路由从通用图谱浏览器改造为以「我」为中心的径向 4 层层级视图（person → partition → topic → article）。

**Architecture:** 新建 `RadialKnowledgeGraph` 组件承载径向布局（不复用 `GraphEditor`，因为 dagre 不支持径向）；改造 `GlobalGraphPage` 为薄壳，调用新组件；复用现有 `?filter_type=partition` 后端端点。布局用纯数学（角度 + 半径），交互通过 React Flow 的 node `data` 字段传递回调。

**Tech Stack:** React 18 + TypeScript + `@xyflow/react` v12 + Tailwind v4 + shadcn/ui。无测试框架（YAGNI），验证通过 `npm run build` + 浏览器人工检查。

**Design Doc:** `docs/plans/2026-06-21-radial-knowledge-graph-design.md`

**关键约束：**
- 不修改 `api/client.ts` 和 `types/*`（OFF-LIMITS）
- 不修改 `GraphEditor.tsx`（OFF-LIMITS）
- 验证门：`cd frontend && npm run build` 必须通过
- 错误处理用 `<Alert variant="destructive">`，不用 `alert()`
- 空状态用 `<EmptyState>`，加载用 `<LoadingSkeleton>`

---

## Task 1: 创建 RadialKnowledgeGraph 组件骨架

**Files:**
- Create: `frontend/src/components/RadialKnowledgeGraph.tsx`

**Step 1: 创建组件骨架**

写入以下内容到 `frontend/src/components/RadialKnowledgeGraph.tsx`：

```tsx
import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphNode, GraphEdge } from '../types/graph';

export type RadialGraphProps = {
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
  onNodeClick?: (nodeId: string) => void;
};

export default function RadialKnowledgeGraph({ graphData, onNodeClick }: RadialGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 占位：等 Task 2/4 实现
  useMemo(() => {
    setNodes([]);
    setEdges([]);
  }, [graphData, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="system"
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
```

**Step 2: 验证类型检查通过**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS（无类型错误）

**Step 3: Commit**

```bash
git add frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): scaffold RadialKnowledgeGraph component"
```

---

## Task 2: 实现径向布局纯函数

**Files:**
- Create: `frontend/src/lib/radial-layout.ts`

**Step 1: 创建布局函数**

写入以下内容到 `frontend/src/lib/radial-layout.ts`：

```ts
import type { GraphNode, GraphEdge } from '../types/graph';

// React Flow 节点数据载荷
export type RadialNodeData = {
  label: string;
  nodeType: GraphNode['nodeType'];
  level: 0 | 1 | 2 | 3;
  parentId?: string;
  childCount?: number;   // topic 用：直接子 article 数（徽章显示）
  expanded?: boolean;    // topic 用：是否展开子节点
  dimmed?: boolean;      // 高亮反衬用
  onSelect?: () => void;
};

export type RadialNode = Node<RadialNodeData>;
export type RadialEdge = Edge;

// 三圈半径
const R1 = 220;  // partition
const R2 = 440;  // topic
const R3 = 640;  // article

// React Flow Node 类型导入
import type { Node, Edge } from '@xyflow/react';

/**
 * 根据 graphData 和展开状态计算每个节点的 (x, y) 位置。
 *
 * - person 固定圆心 (0, 0)
 * - partitions 在半径 R1 圆周上均分
 * - topics 在所属 partition 的扇区内、半径 R2 排列
 * - articles 仅在父 topic 展开时，从 topic 辐射到半径 R3
 */
export function computeRadialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedTopicIds: Set<string>,
  onNodeClick?: (id: string) => void,
): { nodes: RadialNode[]; edges: RadialEdge[] } {
  // 1. 建立父子关系 map
  // edge 方向约定：source 是子，target 是父（与项目里 root/part_of/tag 边一致）
  const parentOf: Record<string, string> = {};
  edges.forEach(e => {
    parentOf[e.source] = e.target;
  });

  // 2. 按 nodeType 分组
  const person = nodes.find(n => n.nodeType === 'person');
  const partitions = nodes.filter(n => n.nodeType === 'partition');
  const topics = nodes.filter(n => n.nodeType === 'topic');
  const articles = nodes.filter(n => n.nodeType === 'article');

  const positions: Record<string, { x: number; y: number }> = {};

  // 3. person 圆心
  if (person) positions[person.id] = { x: 0, y: 0 };

  // 4. partitions 均分 R1
  const partitionCount = partitions.length;
  partitions.forEach((p, i) => {
    const angle = partitionCount > 0 ? (i / partitionCount) * 2 * Math.PI - Math.PI / 2 : 0;
    positions[p.id] = {
      x: R1 * Math.cos(angle),
      y: R1 * Math.sin(angle),
    };
  });

  // 5. topics 在父 partition 的扇区内
  //    扇区角度范围：[(i/partitionCount)*2π, ((i+1)/partitionCount)*2π]
  const topicsByPartition: Record<string, GraphNode[]> = {};
  topics.forEach(t => {
    const pid = parentOf[t.id];
    if (!pid) return;
    if (!topicsByPartition[pid]) topicsByPartition[pid] = [];
    topicsByPartition[pid].push(t);
  });

  partitions.forEach((partition, pi) => {
    const sectorStart = (pi / partitionCount) * 2 * Math.PI - Math.PI / 2;
    const sectorEnd = ((pi + 1) / partitionCount) * 2 * Math.PI - Math.PI / 2;
    const myTopics = topicsByPartition[partition.id] || [];
    const topicCount = myTopics.length;
    myTopics.forEach((t, ti) => {
      // 扇区内均分，留 10% 边距避免贴边
      const t0 = sectorStart + (sectorEnd - sectorStart) * 0.1;
      const t1 = sectorEnd - (sectorEnd - sectorStart) * 0.1;
      const angle = topicCount > 1 ? t0 + (ti / (topicCount - 1)) * (t1 - t0) : (t0 + t1) / 2;
      positions[t.id] = {
        x: R2 * Math.cos(angle),
        y: R2 * Math.sin(angle),
      };
    });
  });

  // 6. articles 仅在父 topic 展开时计算位置
  //    从 topic 辐射一个短弧，半径 R3
  const visibleArticles: GraphNode[] = [];
  const articlesByTopic: Record<string, GraphNode[]> = {};
  articles.forEach(a => {
    const tid = parentOf[a.id];
    if (!tid || !expandedTopicIds.has(tid)) return;
    if (!articlesByTopic[tid]) articlesByTopic[tid] = [];
    articlesByTopic[tid].push(a);
    visibleArticles.push(a);
  });

  Object.entries(articlesByTopic).forEach(([topicId, arts]) => {
    const topicPos = positions[topicId];
    if (!topicPos) return;
    const topicAngle = Math.atan2(topicPos.y, topicPos.x);
    const spread = 0.25;  // 弧度跨度
    arts.forEach((a, ai) => {
      const n = arts.length;
      const offset = n > 1 ? (ai / (n - 1) - 0.5) * spread : 0;
      const angle = topicAngle + offset;
      positions[a.id] = {
        x: R3 * Math.cos(angle),
        y: R3 * Math.sin(angle),
      };
    });
  });

  // 7. 统计每个 topic 的 article 数（徽章用）
  const articleCountByTopic: Record<string, number> = {};
  articles.forEach(a => {
    const tid = parentOf[a.id];
    if (tid) articleCountByTopic[tid] = (articleCountByTopic[tid] || 0) + 1;
  });

  // 8. 构建 React Flow 节点
  const radialNodes: RadialNode[] = nodes
    .filter(n => {
      // 隐藏未展开 topic 下的 article
      if (n.nodeType === 'article') {
        const tid = parentOf[n.id];
        return tid && expandedTopicIds.has(tid);
      }
      return true;
    })
    .map(n => {
      const pos = positions[n.id] || { x: 0, y: 0 };
      const level: RadialNodeData['level'] =
        n.nodeType === 'person' ? 0 :
        n.nodeType === 'partition' ? 1 :
        n.nodeType === 'topic' ? 2 : 3;
      return {
        id: n.id,
        type: 'radial',
        position: pos,
        data: {
          label: n.name,
          nodeType: n.nodeType,
          level,
          parentId: parentOf[n.id],
          childCount: level === 2 ? (articleCountByTopic[n.id] || 0) : undefined,
          expanded: level === 2 ? expandedTopicIds.has(n.id) : undefined,
          onSelect: onNodeClick ? () => onNodeClick(n.id) : undefined,
        },
      };
    });

  // 9. 过滤可见边（隐藏未展开 topic 的 article 边）
  const visibleNodeIds = new Set(radialNodes.map(n => n.id));
  const radialEdges: RadialEdge[] = edges
    .filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default',
      style: { stroke: 'var(--text-subtle)', strokeWidth: 1 },
    }));

  return { nodes: radialNodes, edges: radialEdges };
}
```

**Step 2: 验证类型检查**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/lib/radial-layout.ts
git commit -m "feat(graph): add radial layout pure function"
```

---

## Task 3: 自定义节点渲染器（4 种类型）

**Files:**
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx`

**Step 1: 添加 4 个节点组件 + nodeTypes map**

在 `RadialKnowledgeGraph.tsx` 顶部 import 块下添加：

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { nodeColorVar } from '@/lib/utils';
import type { RadialNodeData, RadialNode } from '@/lib/radial-layout';

// ── 节点渲染器 ──

function PersonNode({ data }: NodeProps<Node<RadialNodeData>>) {
  return (
    <div
      onClick={data.onSelect}
      className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-4 border-[#fbbf24] bg-[#fbbf24]/15 text-base font-bold text-[#fbbf24] shadow-lg"
      style={{ opacity: data.dimmed ? 0.2 : 1 }}
    >
      {data.label}
    </div>
  );
}

function PartitionNode({ data, selected }: NodeProps<Node<RadialNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="flex min-w-[120px] cursor-pointer flex-col items-center rounded-xl border-2 bg-surface p-2 shadow-md"
      style={{ borderColor: selected ? color : 'var(--border)', opacity: data.dimmed ? 0.2 : 1 }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, opacity: 0 }} />
      <span className="text-[10px] uppercase tracking-wide text-text-muted">分区</span>
      <span className="text-sm font-semibold text-text">{data.label}</span>
      <Handle type="source" position={Position.Bottom} style={{ background: color, opacity: 0 }} />
    </div>
  );
}

function TopicNode({ data, selected }: NodeProps<Node<RadialNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="relative flex min-w-[100px] cursor-pointer flex-col rounded-lg border-2 bg-surface p-1.5 shadow-sm"
      style={{ borderColor: selected ? color : 'var(--border)', opacity: data.dimmed ? 0.2 : 1 }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, opacity: 0 }} />
      <span className="px-1 text-[10px] uppercase tracking-wide text-text-muted">主题</span>
      <span className="px-1 text-xs font-semibold text-text">{data.label}</span>
      {data.childCount !== undefined && data.childCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white"
        >
          {data.childCount}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: color, opacity: 0 }} />
    </div>
  );
}

function ArticleNode({ data }: NodeProps<Node<RadialNodeData>>) {
  return (
    <div
      onClick={data.onSelect}
      className="flex max-w-[140px] cursor-pointer items-center rounded-md border bg-surface px-2 py-1 text-xs text-text shadow-sm hover:border-accent"
      style={{ opacity: data.dimmed ? 0.2 : 1 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <span className="truncate">{data.label}</span>
    </div>
  );
}

const nodeTypes = {
  radial: ({ data, selected }: NodeProps<Node<RadialNodeData>>) => {
    switch (data.level) {
      case 0: return <PersonNode data={data} selected={selected} />;
      case 1: return <PartitionNode data={data} selected={selected} />;
      case 2: return <TopicNode data={data} selected={selected} />;
      case 3: return <ArticleNode data={data} selected={selected} />;
    }
  },
};
```

**Step 2: 在主组件 JSX 里注册 nodeTypes**

修改 `ReactFlow` 元素，添加 `nodeTypes={nodeTypes}`：

```tsx
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="system"
      >
```

**Step 3: 类型检查**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): add 4 custom node renderers for radial layout"
```

---

## Task 4: 接入数据 + 布局计算

**Files:**
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx`

**Step 1: 用 computeRadialLayout 替换占位 useMemo**

把 Task 1 里那段占位 `useMemo(() => { setNodes([]); setEdges([]); }, ...)` 整段删除，替换为：

```tsx
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(new Set());

  // 签名触发：节点/边增删时重算布局
  const nodeSig = useMemo(
    () => graphData.nodes.map(n => n.id).sort().join(','),
    [graphData.nodes],
  );
  const edgeSig = useMemo(
    () => graphData.edges.map(e => `${e.source}->${e.target}`).sort().join('|'),
    [graphData.edges],
  );

  // 计算 layout
  const { nodes: laidOutNodes, edges: laidOutEdges } = useMemo(
    () => computeRadialLayout(graphData.nodes, graphData.edges, expandedTopicIds, onNodeClick),
    [graphData.nodes, graphData.edges, expandedTopicIds, onNodeClick],
  );

  React.useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(laidOutEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laidOutNodes, laidOutEdges]);
```

并在顶部 import 块添加：

```tsx
import { useState } from 'react';
import { computeRadialLayout } from '@/lib/radial-layout';
```

**Step 2: 类型检查 + 构建**

```bash
cd frontend && npm run build
```

Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): wire radial layout into RadialKnowledgeGraph"
```

---

## Task 5: 接入 GlobalGraphPage（替换占位渲染）

**Files:**
- Modify: `frontend/src/pages/GlobalGraphPage.tsx`

**Step 1: 读取当前 GlobalGraphPage.tsx 内容（用于参考）**

```bash
cat frontend/src/pages/GlobalGraphPage.tsx | head -50
```

确认它使用 `getGlobalGraph(filterType)` + `graphJsonToGraphData`。

**Step 2: 改造 GlobalGraphPage**

完整替换 `frontend/src/pages/GlobalGraphPage.tsx` 内容为：

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import RadialKnowledgeGraph from '../components/RadialKnowledgeGraph';
import { getGlobalGraph, getArticleSubgraph } from '../api/client';
import { graphJsonToGraphData } from '../lib/graph-mappers';
import { toErrorMessage } from '../lib/errors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../components/ui/sheet';
import { Alert, AlertDescription } from '../components/ui/alert';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';

const LEGEND = [
  { label: '我', color: '#fbbf24' },
  { label: '分区', color: '#6366f1' },
  { label: '主题', color: '#10b981' },
  { label: '文章', color: '#3b82f6' },
];

export default function GlobalGraphPage() {
  const navigate = useNavigate();
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedArticle, setSelectedArticle] = useState<GraphNode | null>(null);
  const [articleGraph, setArticleGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getGlobalGraph('partition');
      setGraphData(graphJsonToGraphData(result));
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (node.nodeType === 'article') {
      setSelectedArticle(node);
      setArticleGraph(null);
      try {
        const data = await getArticleSubgraph(nodeId);
        setArticleGraph(graphJsonToGraphData(data));
      } catch { /* ignore */ }
    }
  }, [graphData.nodes]);

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) setSelectedArticle(null);
  };

  const isEmpty = !loading && graphData.nodes.length === 0;

  return (
    <div className="relative h-[calc(100vh-56px)] w-full">
      {/* Top: 搜索框 */}
      <div className="absolute left-3 right-3 top-3 z-10 flex items-center gap-2">
        <Input
          placeholder="搜索节点（待 Task 9 接入）..."
          className="max-w-xs bg-surface"
          disabled
        />
      </div>

      {/* Legend */}
      <Card className="absolute right-3 top-3 z-10 gap-0 py-2 shadow-md">
        <CardContent className="flex items-center gap-3 px-3">
          {LEGEND.map(l => (
            <div key={l.label} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              <span className="text-xs text-text-muted">{l.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6"><LoadingSkeleton count={4} /></div>
        </div>
      )}

      {error && isEmpty && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6">
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            <div className="mt-4 flex justify-center">
              <Button onClick={load} variant="outline" size="sm">重试</Button>
            </div>
          </div>
        </div>
      )}

      {isEmpty && !error && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <EmptyState
            title="你的知识图谱还是空的"
            hint="导入第一篇文章，系统会自动为你构建知识网络。"
            action={<Button onClick={() => navigate('/import')}>去导入</Button>}
          />
        </div>
      )}

      {!loading && !isEmpty && (
        <RadialKnowledgeGraph graphData={graphData} onNodeClick={handleNodeClick} />
      )}

      {/* Article inspector */}
      <Sheet open={selectedArticle !== null} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right">
          {selectedArticle && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedArticle.name}</SheetTitle>
                <SheetDescription>文章</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                {selectedArticle.description && (
                  <div className="mb-3 px-4 text-sm text-text-muted">{selectedArticle.description}</div>
                )}
                {articleGraph && (
                  <div className="mt-2 px-4">
                    <h4 className="mb-2 text-xs text-text-muted">文章内部图谱</h4>
                    <div className="h-[300px] overflow-hidden rounded-lg border border-border">
                      <GraphEditor graphData={articleGraph} editable={false} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          <SheetFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

**Step 3: 验证构建**

```bash
cd frontend && npm run build
```

Expected: PASS

**Step 4: 浏览器人工验证**

启动 `npm run dev`，访问 `/graph`：
- 中心显示「我」
- 第一圈是分区
- 第二圈是主题（带数字徽章）
- 文章不显示
- 顶部有搜索框（禁用状态）+ 右上图例

**Step 5: Commit**

```bash
git add frontend/src/pages/GlobalGraphPage.tsx
git commit -m "feat(graph): convert GlobalGraphPage to radial hierarchy view"
```

---

## Task 6: Topic 展开/收起交互

**Files:**
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx`

**Step 1: 在组件里拦截 topic 点击，切换 expandedTopicIds**

修改 `RadialKnowledgeGraph.tsx` 中的 `handleNodeClick`：

```tsx
  const handleNodeClickInternal = useCallback(
    (_: React.MouseEvent, node: Node<RadialNodeData>) => {
      // topic 点击 → 切换展开/收起（不冒泡到 onNodeClick）
      if (node.data.level === 2) {
        setExpandedTopicIds(prev => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );
```

并把 JSX 里 `onNodeClick={handleNodeClick}` 改为 `onNodeClick={handleNodeClickInternal}`。

删除原来的 `handleNodeClick` 函数（被 `_internal` 版本取代）。

**Step 2: 类型检查 + 构建**

```bash
cd frontend && npm run build
```

Expected: PASS

**Step 3: 浏览器验证**

- 点击 topic，文章从该 topic 辐射出来（第三圈）
- 再次点击，文章消失

**Step 4: Commit**

```bash
git add frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): topic expand/collapse interaction"
```

---

## Task 7: Partition 高亮（点暗其他）

**Files:**
- Modify: `frontend/src/lib/radial-layout.ts`
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx`

**Step 1: 扩展 computeRadialLayout 接受 highlightedPartitionId**

在 `radial-layout.ts` 的 `computeRadialLayout` 签名增加参数：

```ts
export function computeRadialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedTopicIds: Set<string>,
  onNodeClick?: (id: string) => void,
  highlightedPartitionId?: string | null,
): { nodes: RadialNode[]; edges: RadialEdge[] } {
```

在第 8 步构建 `radialNodes.map` 内部，根据 `highlightedPartitionId` 设置 `dimmed`：

```ts
    .map(n => {
      const pos = positions[n.id] || { x: 0, y: 0 };
      const level: RadialNodeData['level'] =
        n.nodeType === 'person' ? 0 :
        n.nodeType === 'partition' ? 1 :
        n.nodeType === 'topic' ? 2 : 3;

      // 计算 dimmed：有高亮分区时，不属于该分区的节点淡化
      let dimmed = false;
      if (highlightedPartitionId) {
        if (n.id === highlightedPartitionId) {
          dimmed = false;
        } else {
          // 判断节点是否属于该分区
          let cur: string | undefined = n.id;
          let belongs = false;
          while (cur) {
            if (cur === highlightedPartitionId) { belongs = true; break; }
            cur = parentOf[cur];
          }
          dimmed = !belongs;
        }
      }

      return {
        id: n.id,
        type: 'radial',
        position: pos,
        data: {
          label: n.name,
          nodeType: n.nodeType,
          level,
          parentId: parentOf[n.id],
          childCount: level === 2 ? (articleCountByTopic[n.id] || 0) : undefined,
          expanded: level === 2 ? expandedTopicIds.has(n.id) : undefined,
          dimmed,
          onSelect: onNodeClick ? () => onNodeClick(n.id) : undefined,
        },
      };
    });
```

**Step 2: 在 RadialKnowledgeGraph.tsx 增加高亮状态**

在 `expandedTopicIds` 状态下加：

```tsx
  const [highlightedPartitionId, setHighlightedPartitionId] = useState<string | null>(null);
```

修改 `computeRadialLayout` 调用：

```tsx
  const { nodes: laidOutNodes, edges: laidOutEdges } = useMemo(
    () => computeRadialLayout(
      graphData.nodes,
      graphData.edges,
      expandedTopicIds,
      onNodeClick,
      highlightedPartitionId,
    ),
    [graphData.nodes, graphData.edges, expandedTopicIds, onNodeClick, highlightedPartitionId],
  );
```

修改 `handleNodeClickInternal`：

```tsx
  const handleNodeClickInternal = useCallback(
    (_: React.MouseEvent, node: Node<RadialNodeData>) => {
      if (node.data.level === 2) {
        setExpandedTopicIds(prev => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      if (node.data.level === 1) {
        // partition 点击切换高亮
        setHighlightedPartitionId(prev => prev === node.id ? null : node.id);
        return;
      }
      if (node.data.level === 0) {
        // person 点击重置
        setHighlightedPartitionId(null);
        setExpandedTopicIds(new Set());
        return;
      }
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );
```

**Step 3: 类型检查 + 构建**

```bash
cd frontend && npm run build
```

Expected: PASS

**Step 4: 浏览器验证**

- 点击 partition，该分区+其 topics+展开的 articles 保持亮色，其他节点淡化
- 再次点击或点击「我」恢复

**Step 5: Commit**

```bash
git add frontend/src/lib/radial-layout.ts frontend/src/components/RadialKnowledgeGraph.tsx
git commit -m "feat(graph): partition highlight on click"
```

---

## Task 8: 更新侧边栏文案

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Step 1: 修改 NAV 数组里的 /graph 标签**

打开 `frontend/src/components/layout/Sidebar.tsx`，找到第 11 行：

```tsx
  { to: '/graph', label: '全局图谱', icon: Network },
```

改为：

```tsx
  { to: '/graph', label: '我的图谱', icon: Network },
```

**Step 2: 类型检查（不会出错但跑一下）**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(graph): rename sidebar label to 我的知识图谱"
```

---

## Task 9: 搜索框高亮行为

**Files:**
- Modify: `frontend/src/pages/GlobalGraphPage.tsx`
- Modify: `frontend/src/components/RadialKnowledgeGraph.tsx`
- Modify: `frontend/src/lib/radial-layout.ts`

**Step 1: 在 RadialKnowledgeGraph 增加 searchQuery prop**

在 `RadialGraphProps` 加：

```tsx
export type RadialGraphProps = {
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
  onNodeClick?: (nodeId: string) => void;
  searchQuery?: string;
};
```

在组件内加状态传给 layout：

```tsx
export default function RadialKnowledgeGraph({ graphData, onNodeClick, searchQuery = '' }: RadialGraphProps) {
```

修改 `computeRadialLayout` 调用，传入 `searchQuery` 作为第 6 个参数（或在 highlightedPartitionId 之后再加一个）。

**Step 2: 在 radial-layout.ts 接受 searchQuery**

签名加：

```ts
export function computeRadialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedTopicIds: Set<string>,
  onNodeClick?: (id: string) => void,
  highlightedPartitionId?: string | null,
  searchQuery?: string,
): { nodes: RadialNode[]; edges: RadialEdge[] } {
```

在构建节点时合并 dimmed 逻辑：

```ts
      // 搜索匹配：未命中也淡化
      const matchedSearch = !searchQuery || n.name.toLowerCase().includes(searchQuery.toLowerCase());
      dimmed = dimmed || !matchedSearch;
```

**Step 3: GlobalGraphPage 传入 searchQuery**

在 `GlobalGraphPage.tsx` 加 state：

```tsx
  const [searchQuery, setSearchQuery] = useState('');
```

Input 解禁并绑事件：

```tsx
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索节点..."
          className="max-w-xs bg-surface"
        />
```

并把 `RadialKnowledgeGraph` 加上 prop：

```tsx
        <RadialKnowledgeGraph
          graphData={graphData}
          onNodeClick={handleNodeClick}
          searchQuery={searchQuery}
        />
```

**Step 4: 类型检查 + 构建**

```bash
cd frontend && npm run build
```

Expected: PASS

**Step 5: 浏览器验证**

- 在搜索框输入 topic 名，其他节点淡化
- 清空搜索框恢复

**Step 6: Commit**

```bash
git add frontend/src/pages/GlobalGraphPage.tsx frontend/src/components/RadialKnowledgeGraph.tsx frontend/src/lib/radial-layout.ts
git commit -m "feat(graph): search box highlight"
```

---

## Task 10: 最终验证 + 清理

**Files:**
- Read-only verify

**Step 1: 完整构建**

```bash
cd frontend && npm run build
```

Expected: PASS（vite build 输出 dist/ 文件）

**Step 2: 浏览器完整走查清单**

启动 `npm run dev`，访问 `/graph`，逐项验证：

- [ ] 中心是「我」节点
- [ ] 第一圈是所有分区，圆周均分
- [ ] 第二圈是主题，每个主题在自己的分区扇区内
- [ ] 主题带数字徽章显示子文章数
- [ ] 文章默认不显示
- [ ] 点击任一 topic，其文章从该 topic 辐射出来
- [ ] 再次点击该 topic，文章收起
- [ ] 点击 partition，其他节点淡化
- [ ] 点击「我」恢复默认
- [ ] 点击 article，右侧 Sheet 弹出显示详情+子图
- [ ] 搜索框输入关键字，匹配节点高亮其他淡化
- [ ] 侧边栏文案是「我的图谱」
- [ ] 顶部右侧有图例
- [ ] 没有「全部/主题/文章/分区」过滤按钮

**Step 3: 处理遗留问题**

如果某项失败，定位并修复（小修不另起 task，直接 commit 到这个 task）。

**Step 4: Commit 最终验证状态**

```bash
git add -A
git commit --allow-empty -m "chore(graph): final verification of radial view"
```

---

## 风险与备选

1. **节点规模过大**：超过 5 分区 × 20 主题 × 10 文章时，第二圈会拥挤。当前缓解：默认收起文章。如果还拥挤，再考虑动态字号或分区切换 UI。

2. **React Flow 性能**：1000+ 节点会卡。当前规模（默认 26 节点）没问题。

3. **扇区角度过窄**：单分区下 30+ 主题时扇区内挤。当前不硬限，让用户感知"该拆分区"。

4. **后端 `?filter_type=partition` 改动**：如果后端将来修改该端点行为（比如不再返回 person 节点），需要新增专用端点。当前 YAGNI。
