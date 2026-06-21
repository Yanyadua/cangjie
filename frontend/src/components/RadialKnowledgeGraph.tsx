import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeColorVar } from '@/lib/utils';
import { computeRadialLayout } from '@/lib/radial-layout';
import type { RadialNodeData, RadialNode } from '@/lib/radial-layout';
import type { GraphNode, GraphEdge } from '../types/graph';

// ── 节点渲染器 ──

function PersonNode({ data }: NodeProps<Node<RadialNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-4 text-base font-bold shadow-lg"
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        opacity: data.dimmed ? 0.2 : 1,
      }}
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
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
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
  radial: (props: NodeProps<Node<RadialNodeData>>) => {
    switch (props.data.level) {
      case 0: return <PersonNode {...props} />;
      case 1: return <PartitionNode {...props} />;
      case 2: return <TopicNode {...props} />;
      case 3: return <ArticleNode {...props} />;
    }
  },
};

export type RadialGraphProps = {
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
  onNodeClick?: (nodeId: string) => void;
};

export default function RadialKnowledgeGraph({ graphData, onNodeClick }: RadialGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(new Set());
  const [highlightedPartitionId, setHighlightedPartitionId] = useState<string | null>(null);

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

  useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(laidOutEdges);
  }, [laidOutNodes, laidOutEdges, setNodes, setEdges]);

  const handleNodeClickInternal = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as RadialNodeData;
      if (data.level === 2) {
        // topic → toggle expand
        setExpandedTopicIds(prev => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      if (data.level === 1) {
        // partition → toggle highlight
        setHighlightedPartitionId(prev => prev === node.id ? null : node.id);
        return;
      }
      if (data.level === 0) {
        // person → reset
        setHighlightedPartitionId(null);
        setExpandedTopicIds(new Set());
        return;
      }
      // article → delegate
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
        onNodeClick={handleNodeClickInternal}
        nodeTypes={nodeTypes}
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
