// frontend/src/lib/galaxy-mappers.ts
import type { GraphNode, GraphEdge } from '../types/graph';

export interface PartitionCoreData {
  id: string;
  name: string;
  description?: string;
}

export interface ArticleStarData {
  id: string;
  name: string;
  description?: string;
  /** original node, kept for ArticleSheet + debug */
  node: GraphNode;
}

export interface TopicClusterData {
  id: string;
  name: string;
  description?: string;
  /** articles linked via `tag` edges (source=topic, target=article OR source=article, target=topic) */
  articles: ArticleStarData[];
  /** original node, kept for tooltip + debug */
  node: GraphNode;
}

export interface GalaxyScene {
  partition: PartitionCoreData | null;
  topics: TopicClusterData[];
  /** orphan articles (linked directly to partition via `belongs_to`, no parent topic) */
  orphanArticles: ArticleStarData[];
  /** topic→topic semantic edges within the partition (related_to / contains / similar_to etc.) */
  topicEdges: GraphEdge[];
}

/**
 * Transform a local graph (partition subgraph, hops=2) into a GalaxyScene.
 *
 * - partition = the single 'partition' node
 * - topics    = all 'topic' nodes, each with child articles resolved via `tag` edges
 * - orphanArticles = 'article' nodes NOT linked to any topic via `tag` (e.g. legacy `belongs_to` partition link)
 * - topicEdges = edges where BOTH endpoints are topics (lateral semantic links)
 *
 * Input: GraphNode[] / GraphEdge[] (camelCase, already converted from backend wire by graphJsonToGraphData).
 */
export function localGraphToGalaxyScene(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GalaxyScene {
  const partitionNode = nodes.find(n => n.nodeType === 'partition') ?? null;
  const partition: PartitionCoreData | null = partitionNode
    ? {
        id: partitionNode.id,
        name: partitionNode.name || '未命名分区',
        description: partitionNode.description,
      }
    : null;

  const topicNodes = nodes.filter(n => n.nodeType === 'topic');
  const articleNodes = nodes.filter(n => n.nodeType === 'article');
  const topicIdSet = new Set(topicNodes.map(t => t.id));
  const articleIdSet = new Set(articleNodes.map(a => a.id));

  // Build topicId → articleIds index from `tag` edges (either direction).
  const topicToArticles = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relationType !== 'tag') continue;
    if (e.source === e.target) continue; // self-loop
    // exactly one endpoint must be a topic; the other an article
    const sourceIsTopic = topicIdSet.has(e.source);
    const targetIsTopic = topicIdSet.has(e.target);
    let topicId: string | null = null;
    let otherId: string | null = null;
    if (sourceIsTopic && !targetIsTopic && articleIdSet.has(e.target)) {
      topicId = e.source;
      otherId = e.target;
    } else if (targetIsTopic && !sourceIsTopic && articleIdSet.has(e.source)) {
      topicId = e.target;
      otherId = e.source;
    }
    if (!topicId || !otherId) continue;
    const arr = topicToArticles.get(topicId) ?? [];
    arr.push(otherId);
    topicToArticles.set(topicId, arr);
  }

  const topics: TopicClusterData[] = topicNodes.map(t => {
    const articleIds = topicToArticles.get(t.id) ?? [];
    const articles: ArticleStarData[] = articleIds
      .map(aid => articleNodes.find(a => a.id === aid))
      .filter((a): a is GraphNode => !!a)
      .map(a => ({
        id: a.id,
        name: a.name || '未命名文章',
        description: a.description,
        node: a,
      }));
    return {
      id: t.id,
      name: t.name || '未命名主题',
      description: t.description,
      articles,
      node: t,
    };
  });

  // Orphan articles: articles in the subgraph that have NO `tag` edge to any topic in this partition.
  const taggedArticleIds = new Set<string>();
  for (const ids of topicToArticles.values()) {
    for (const id of ids) taggedArticleIds.add(id);
  }
  const orphanArticles: ArticleStarData[] = articleNodes
    .filter(a => !taggedArticleIds.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name || '未命名文章',
      description: a.description,
      node: a,
    }));

  // Lateral topic↔topic edges (both endpoints are topics)
  const topicEdges = edges.filter(
    e => topicIdSet.has(e.source) && topicIdSet.has(e.target) && e.source !== e.target,
  );

  return { partition, topics, orphanArticles, topicEdges };
}

/**
 * Apply the M2 article-count cap (design §5.7: "折叠低优先级 topic").
 * Strategy: when total article count exceeds `maxArticles`, fully empty topics
 * with the FEWEST articles first (preserving the topic node itself, just clearing
 * its `articles` array). If still over after emptying all topics, trim orphans
 * from the end. Returns a new scene + the number of articles dropped.
 *
 * Note: this is a "collapse whole topics" strategy, not partial trimming.
 * Rationale: a half-trimmed topic cluster looks visually broken; either show
 * all of a topic's articles or none.
 */
export function capArticles(scene: GalaxyScene, maxArticles = 200): {
  scene: GalaxyScene;
  dropped: number;
} {
  const total = scene.topics.reduce((sum, t) => sum + t.articles.length, 0)
    + scene.orphanArticles.length;
  if (total <= maxArticles) return { scene, dropped: 0 };

  // Sort topics by article count ascending; we'll empty the smallest ones until under cap.
  const sortedTopics = [...scene.topics].sort(
    (a, b) => a.articles.length - b.articles.length,
  );

  let remaining = total;
  let dropped = 0;
  const emptiedTopicIds = new Set<string>();

  for (const t of sortedTopics) {
    if (remaining <= maxArticles) break;
    remaining -= t.articles.length;
    dropped += t.articles.length;
    emptiedTopicIds.add(t.id);
  }

  const cappedTopics = scene.topics.map(t =>
    emptiedTopicIds.has(t.id) ? { ...t, articles: [] } : t,
  );

  // If still over, trim orphan articles
  let orphanArticles = scene.orphanArticles;
  if (remaining > maxArticles) {
    const cut = remaining - maxArticles;
    dropped += cut;
    orphanArticles = scene.orphanArticles.slice(0, Math.max(0, orphanArticles.length - cut));
  }

  return {
    scene: { ...scene, topics: cappedTopics, orphanArticles },
    dropped,
  };
}
