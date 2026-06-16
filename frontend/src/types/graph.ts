export type NodeType =
  | 'article'
  | 'concept'
  | 'claim'
  | 'topic'
  | 'person'
  | 'organization'
  | 'paper'
  | 'project'
  | 'framework'
  | 'tool'
  | 'method'
  | 'technology'
  | 'question'
  | 'chunk'
  | 'partition';

export type RelationType =
  | 'tag'
  | 'related_to'
  | 'contains'
  | 'part_of'
  | 'supports'
  | 'contradicts'
  | 'depends_on'
  | 'implements'
  | 'improves'
  | 'causes'
  | 'compares_with'
  | 'derived_from'
  | 'used_for'
  | 'evidence_for'
  | 'mentions'
  | 'similar_to'
  | 'belongs_to'
  | 'root';

export type GraphNode = {
  id: string;
  nodeType: NodeType;
  name: string;
  description?: string;
  x?: number;
  y?: number;
  isDraft?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationType: RelationType;
  confidence?: number;
  evidence?: string;
};

export type GraphData = {
  summary?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type TopicTag = {
  name: string;
  confidence?: number;
};

export type CoreClaim = {
  name: string;
  description: string;
};

export type SkeletonData = {
  summary: string;
  topic_tags: TopicTag[];
  core_claims: CoreClaim[];
};

export type ExpandedData = {
  nodes: Array<{
    temp_id: string;
    node_type: NodeType;
    name: string;
    description: string;
  }>;
  edges: Array<{
    temp_id: string;
    source: string;
    target: string;
    relation_type: RelationType;
    confidence: number;
    evidence: string;
  }>;
};

export type DocumentResponse = {
  id: string;
  title: string;
  source_type?: string;
  status: string;
  created_at: string;
};

export type DraftGraphResponse = {
  id: string;
  document_id: string;
  graph_json: GraphData;
  status: string;
};

export type InsertionProposalJSON = {
  candidate_positions: Array<{
    target_node_id: string;
    target_node_name: string;
    reason: string;
    score: number;
  }>;
  suggested_merges: Array<{
    draft_node_temp_id: string;
    existing_node_id: string;
    reason: string;
    confidence: number;
  }>;
  suggested_edges: Array<{
    source: string;
    target: string;
    relation_type: RelationType;
    reason: string;
    confidence: number;
  }>;
  possible_conflicts: Array<Record<string, unknown>>;
};

export type InsertionProposalResponse = {
  id: string;
  document_id: string;
  proposal_json: InsertionProposalJSON;
  status: string;
};

// ── Clustering Proposal ──

export type PartitionAction = {
  action: 'MATCH' | 'NEW';
  target_partition_id?: string;
  target_partition_name?: string;
  proposed_name?: string;
  proposed_description?: string;
  score: number;
  candidates: Array<{
    id: string;
    name: string;
    score: number;
  }>;
  reason: string;
};

export type TagAction = {
  tag_name: string;
  action: 'MERGE' | 'NEW';
  target_topic_id?: string;
  confidence: number;
  reason: string;
  matched_candidates: Array<{
    id: string;
    name: string;
    similarity: number;
  }>;
  proposed_description?: string;
  temp_id?: string;
};

export type TopicEdgeProposal = {
  source_tag: string;
  target_tag: string;
  relation_type: string;
  reason: string;
};

export type ClusteringProposalJSON = {
  article_title: string;
  article_summary: string;
  document_id: string;
  partition_action: PartitionAction;
  tag_actions: TagAction[];
  topic_edges: TopicEdgeProposal[];
};

export type ClusteringProposalResponse = {
  id: string;
  document_id: string;
  proposal_json: ClusteringProposalJSON;
  status: string;
};

export type SearchResult = {
  chunks: Array<{
    id: string;
    document_id: string;
    content: string;
    score: number;
  }>;
  nodes: Array<{
    id: string;
    node_type: string;
    name: string;
    description?: string;
    score: number;
  }>;
  documents: Array<DocumentResponse>;
};

export const NODE_COLORS: Record<string, string> = {
  article: '#3b82f6',
  concept: '#10b981',
  claim: '#f97316',
  topic: '#8b5cf6',
  person: '#fbbf24',
  organization: '#6366f1',
  paper: '#0ea5e9',
  project: '#14b8a6',
  framework: '#f59e0b',
  tool: '#ec4899',
  method: '#64748b',
  technology: '#22c55e',
  question: '#a855f7',
  chunk: '#94a3b8',
  partition: '#6366f1',
};

export const NODE_TYPES: NodeType[] = [
  'article', 'concept', 'claim', 'topic', 'person', 'organization',
  'paper', 'project', 'framework', 'tool', 'method', 'technology', 'question',
  'partition',
];

export const RELATION_TYPES: RelationType[] = [
  'tag', 'related_to', 'contains', 'part_of', 'supports', 'contradicts',
  'depends_on', 'implements', 'improves', 'causes', 'compares_with',
  'derived_from', 'used_for', 'evidence_for', 'mentions', 'similar_to', 'belongs_to',
  'root',
];
