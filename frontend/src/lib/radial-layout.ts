import type { Node, Edge } from '@xyflow/react';
import type { GraphNode, GraphEdge } from '../types/graph';

// React Flow 节点数据载荷
export type RadialNodeData = {
  label: string;
  nodeType: GraphNode['nodeType'];
  level: 0 | 1 | 2 | 3;
  parentId?: string;
  childCount?: number;
  expanded?: boolean;
  dimmed?: boolean;
  onSelect?: () => void;
};

export type RadialNode = Node<RadialNodeData>;
export type RadialEdge = Edge;

// 三圈半径
const R1 = 220;
const R2 = 440;
const R3 = 640;

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
  highlightedPartitionId?: string | null,
): { nodes: RadialNode[]; edges: RadialEdge[] } {
  // 1. 建立父子关系 map
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
  const articlesByTopic: Record<string, GraphNode[]> = {};
  articles.forEach(a => {
    const tid = parentOf[a.id];
    if (!tid || !expandedTopicIds.has(tid)) return;
    if (!articlesByTopic[tid]) articlesByTopic[tid] = [];
    articlesByTopic[tid].push(a);
  });

  Object.entries(articlesByTopic).forEach(([topicId, arts]) => {
    const topicPos = positions[topicId];
    if (!topicPos) return;
    const topicAngle = Math.atan2(topicPos.y, topicPos.x);
    const spread = 0.25;
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

  // 7. 统计每个 topic 的 article 数
  const articleCountByTopic: Record<string, number> = {};
  articles.forEach(a => {
    const tid = parentOf[a.id];
    if (tid) articleCountByTopic[tid] = (articleCountByTopic[tid] || 0) + 1;
  });

  // 8. 构建 React Flow 节点
  const radialNodes: RadialNode[] = nodes
    .filter(n => {
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

      let dimmed = false;
      if (highlightedPartitionId) {
        if (n.id === highlightedPartitionId) {
          dimmed = false;
        } else {
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
