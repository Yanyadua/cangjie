import type { GraphNode, GraphEdge } from '../types/graph';

// Wire format from /draft-graphs endpoints — snake_case, temp_id OR id
type WireNode = {
  temp_id?: string;
  id?: string;
  node_type: GraphNode['nodeType'];
  name: string;
  description?: string;
};
type WireEdge = {
  temp_id?: string;
  id?: string;
  source: string;
  target: string;
  relation_type?: GraphEdge['relationType'];
  confidence?: number;
  evidence?: string;
};
type WireGraphJson = { nodes?: WireNode[]; edges?: WireEdge[]; summary?: string };

export function mapWireNode(n: WireNode): GraphNode {
  return {
    id: n.temp_id || n.id || '',
    nodeType: n.node_type,
    name: n.name,
    description: n.description,
  };
}

export function mapWireEdge(e: WireEdge): GraphEdge {
  return {
    id: e.temp_id || e.id || '',
    source: e.source,
    target: e.target,
    relationType: e.relation_type || 'related_to',
    confidence: e.confidence,
    evidence: e.evidence,
  };
}

export function graphJsonToGraphData(gj: WireGraphJson | unknown): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!gj || typeof gj !== 'object') return { nodes: [], edges: [] };
  const g = gj as WireGraphJson;
  return {
    nodes: (g.nodes || []).map(mapWireNode),
    edges: (g.edges || []).map(mapWireEdge),
  };
}
