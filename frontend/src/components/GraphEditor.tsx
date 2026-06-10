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
import type { GraphNode, GraphEdge, NODE_COLORS as NodeColorsType } from '../types/graph';
import { NODE_COLORS } from '../types/graph';

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
    position: { x: gn.x ?? Math.random() * 600, y: gn.y ?? Math.random() * 400 },
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

  // Sync external data changes
  React.useEffect(() => {
    setNodes(graphData.nodes.map((n) => graphNodeToFlowNode(n, onNodeClick)));
    setEdges(graphData.edges.map(graphEdgeToFlowEdge));
  }, [graphData, onNodeClick, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable) return;
      setEdges((eds) => addEdge({ ...connection, label: 'related_to' }, eds));
    },
    [editable, setEdges],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
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
        style={{ background: '#f8fafc' }}
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
