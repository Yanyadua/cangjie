import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  Handle,
  Position,
  type NodeProps,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { GraphNode, GraphEdge } from '../types/graph';
import { nodeColorVar } from '@/lib/utils';

// ── Dagre hierarchical layout ──

function dagreLayout(
  nodes: Node<CustomNodeData>[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): Node<CustomNodeData>[] {
  if (nodes.length === 0) return [];

  const NODE_W = 160;
  const NODE_H = 60;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    ranksep: 100,
    nodesep: 40,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: {
        x: Math.round(pos.x - NODE_W / 2),
        y: Math.round(pos.y - NODE_H / 2),
      },
    };
  });
}

// ── Custom Node ──

type CustomNodeData = {
  label: string;
  nodeType: string;
  onSelect?: () => void;
};

function CustomNode({ data, selected }: NodeProps<Node<CustomNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="min-w-[120px] max-w-[200px] rounded-xl border bg-surface p-2 shadow-sm"
      style={{ borderColor: selected ? color : 'var(--border)' }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div className="flex items-center gap-1.5">
        <span className="h-3 w-1 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{data.nodeType}</span>
      </div>
      <div className="text-[13px] font-semibold text-text">{data.label}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

// ── Helpers ──

function graphNodeToFlowNode(gn: GraphNode, onSelectNode?: (id: string) => void): Node<CustomNodeData> {
  return {
    id: gn.id,
    type: 'custom',
    position: { x: gn.x ?? 0, y: gn.y ?? 0 },
    data: {
      label: gn.name,
      nodeType: gn.nodeType,
      onSelect: onSelectNode ? () => onSelectNode(gn.id) : undefined,
    },
  };
}

function graphEdgeToFlowEdge(ge: GraphEdge): Edge {
  return {
    id: ge.id,
    source: ge.source,
    target: ge.target,
    label: ge.relationType,
    style: { stroke: 'var(--text-subtle)' },
  };
}

// ── Props ──

export type GraphEditorProps = {
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
  onChange?: (data: { nodes: GraphNode[]; edges: GraphEdge[] }) => void;
  editable?: boolean;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
};

export default function GraphEditor({
  graphData,
  onChange,
  editable = false,
  onNodeClick,
  onEdgeClick,
}: GraphEditorProps) {
  const initialNodes = useMemo(
    () => graphData.nodes.map((n) => graphNodeToFlowNode(n, onNodeClick)),
    [graphData.nodes, onNodeClick],
  );
  const initialEdges = useMemo(
    () => graphData.edges.map(graphEdgeToFlowEdge),
    [graphData.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Signature-based layout trigger: only re-layout when nodes/edges are added/removed
  const nodeSig = useMemo(
    () => graphData.nodes.map(n => n.id).sort().join(','),
    [graphData.nodes],
  );
  const edgeSig = useMemo(
    () => graphData.edges.map(e => `${e.source}->${e.target}`).sort().join('|'),
    [graphData.edges],
  );

  React.useEffect(() => {
    if (graphData.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const flowNodes = graphData.nodes.map(n => graphNodeToFlowNode(n, onNodeClick));
    const flowEdges = graphData.edges.map(graphEdgeToFlowEdge);
    const laidOut = dagreLayout(flowNodes, flowEdges);
    setNodes(laidOut);
    setEdges(flowEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSig, edgeSig]);

  // Data sync: update node content (label/type/onSelect) without re-layout
  React.useEffect(() => {
    setNodes(prev => prev.map(node => {
      const gn = graphData.nodes.find(n => n.id === node.id);
      if (!gn) return node;
      return {
        ...node,
        data: {
          ...node.data,
          label: gn.name,
          nodeType: gn.nodeType,
          onSelect: onNodeClick ? () => onNodeClick(gn.id) : node.data.onSelect,
        },
      };
    }));
  }, [graphData.nodes, onNodeClick, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable) return;
      setEdges((eds) => addEdge({ ...connection, label: 'related_to' }, eds));
    },
    [editable, setEdges],
  );

  const onNodeDragStop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_: any, node: Node) => {
      if (!onChange) return;
      const updatedGraphNodes = graphData.nodes.map((gn) =>
        gn.id === node.id ? { ...gn, x: node.position.x, y: node.position.y } : gn,
      );
      onChange({ nodes: updatedGraphNodes, edges: graphData.edges });
    },
    [graphData, onChange],
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onEdgeClick?.(edge.id);
    },
    [onEdgeClick],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={handleEdgeClick}
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
