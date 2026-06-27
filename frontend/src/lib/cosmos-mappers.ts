// frontend/src/lib/cosmos-mappers.ts
import type { GraphNode, GraphEdge } from '../types/graph';

export interface BlackHoleData {
  id: string;
  name: string;
}

export interface GalaxyData {
  id: string;
  name: string;
  /** child topic/article count, if computable from edges; else 0 */
  childCount: number;
  /** original node, kept for navigation/debug */
  node: GraphNode;
}

export interface CosmosScene {
  blackHole: BlackHoleData | null;
  galaxies: GalaxyData[];
  /** only the root edges person→partition, for future drawing */
  rootEdges: GraphEdge[];
}

/**
 * Transform a global graph (filter_type=partition) into a CosmosScene.
 * - blackHole = the single 'person' node
 * - galaxies  = all 'partition' nodes
 * - childCount = number of edges whose source or target is this partition (rough proxy)
 */
export function graphDataToCosmosScene(
  nodes: GraphNode[],
  edges: GraphEdge[],
): CosmosScene {
  const person = nodes.find(n => n.nodeType === 'person');
  const partitions = nodes.filter(n => n.nodeType === 'partition');

  const blackHole: BlackHoleData | null = person
    ? { id: person.id, name: person.name || '我' }
    : null;

  const galaxies: GalaxyData[] = partitions.map(p => ({
    id: p.id,
    name: p.name,
    childCount: edges.filter(e => e.source === p.id || e.target === p.id).length,
    node: p,
  }));

  const rootEdges = edges.filter(
    e => e.relationType === 'root',
  );

  return { blackHole, galaxies, rootEdges };
}
