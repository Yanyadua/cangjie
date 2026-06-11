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
import type { GraphNode, GraphEdge } from '../types/graph';
import { NODE_COLORS } from '../types/graph';

// ── Force-directed layout ──

type Vec2 = { x: number; y: number };

function forceLayout(
  nodes: Node<CustomNodeData>[],
  edges: Edge[],
): Node<CustomNodeData>[] {
  if (nodes.length === 0) return [];

  const n = nodes.length;
  const pos: Vec2[] = nodes.map((_, i) => ({
    x: 400 + Math.cos((2 * Math.PI * i) / n) * (150 + n * 10),
    y: 300 + Math.sin((2 * Math.PI * i) / n) * (150 + n * 10),
  }));

  // Build adjacency for fast lookup
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const REPULSION = 8000;
  const ATTRACTION = 0.005;
  const IDEAL_EDGE_LEN = 180;
  const DAMPING = 0.85;
  const ITERATIONS = 120;

  const vel: Vec2[] = nodes.map(() => ({ x: 0, y: 0 }));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const temp = 1 - iter / ITERATIONS; // cooling

    // Repulsion: all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;
        const force = (REPULSION / (dist * dist)) * temp;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vel[i].x += fx;
        vel[i].y += fy;
        vel[j].x -= fx;
        vel[j].y -= fy;
      }
    }

    // Attraction: connected pairs
    for (const e of edges) {
      const si = nodes.findIndex(nd => nd.id === e.source);
      const ti = nodes.findIndex(nd => nd.id === e.target);
      if (si < 0 || ti < 0) continue;
      const dx = pos[ti].x - pos[si].x;
      const dy = pos[ti].y - pos[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1;
      const force = (dist - IDEAL_EDGE_LEN) * ATTRACTION * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      vel[si].x += fx;
      vel[si].y += fy;
      vel[ti].x -= fx;
      vel[ti].y -= fy;
    }

    // Center gravity (mild pull toward center)
    for (let i = 0; i < n; i++) {
      vel[i].x += (400 - pos[i].x) * 0.001;
      vel[i].y += (300 - pos[i].y) * 0.001;
    }

    // Apply velocity with damping
    for (let i = 0; i < n; i++) {
      vel[i].x *= DAMPING;
      vel[i].y *= DAMPING;
      pos[i].x += vel[i].x;
      pos[i].y += vel[i].y;
    }
  }

  // Normalize: shift so min is at 0,0
  let minX = Infinity, minY = Infinity;
  for (const p of pos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  for (const p of pos) {
    p.x -= minX;
    p.y -= minY;
  }

  return nodes.map((node, i) => ({
    ...node,
    position: { x: Math.round(pos[i].x), y: Math.round(pos[i].y) },
  }));
}

// ── Custom Node ──

type CustomNodeData = {
  label: string;
  nodeType: string;
  onSelect?: () => void;
};

function CustomNode({ data }: NodeProps<Node<CustomNodeData>>) {
  const color = NODE_COLORS[data.nodeType] || '#94a3b8';
  return (
    <div
      style={{
        padding: '8px 14px',
        borderRadius: 8,
        border: `2px solid ${color}`,
        background: '#fff',
        fontSize: 13,
        minWidth: 100,
        maxWidth: 200,
        cursor: 'pointer',
      }}
      onClick={data.onSelect}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{data.label}</div>
      <div style={{ fontSize: 10, color }}>{data.nodeType}</div>
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
    style: { stroke: '#94a3b8' },
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

  // Sync external data changes + apply force layout
  React.useEffect(() => {
    if (graphData.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const flowNodes = graphData.nodes.map((n) => graphNodeToFlowNode(n, onNodeClick));
    const flowEdges = graphData.edges.map(graphEdgeToFlowEdge);

    const laidOut = forceLayout(flowNodes, flowEdges);

    setNodes(laidOut);
    setEdges(flowEdges);
  }, [graphData, onNodeClick, setNodes, setEdges]);

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
    <div style={{ width: '100%', height: '100%' }}>
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
        style={{ background: '#f8fafc' }}
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
