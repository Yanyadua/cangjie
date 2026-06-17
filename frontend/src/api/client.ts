import axios from 'axios';
import type {
  DocumentImportRequest,
  ImportResponse,
  ConfirmResponse,
  ApplyResponse,
  AskRequest,
  AskResponse,
} from '../types/api';
import type { GraphData, DraftGraphResponse, InsertionProposalResponse, SearchResult, ClusteringProposalJSON, ClusteringProposalResponse } from '../types/graph';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

// ── Documents ──

export async function importDocument(data: DocumentImportRequest): Promise<ImportResponse> {
  const res = await api.post<ImportResponse>('/documents/import', data);
  return res.data;
}

export async function getDocuments(skip = 0, limit = 20) {
  const res = await api.get('/documents', { params: { skip, limit } });
  return res.data;
}

export async function getDocument(documentId: string) {
  const res = await api.get(`/documents/${documentId}`);
  return res.data;
}

// ── Draft Graphs ──

export async function getDraftGraph(draftGraphId: string): Promise<DraftGraphResponse> {
  const res = await api.get<DraftGraphResponse>(`/draft-graphs/${draftGraphId}`);
  return res.data;
}

export async function updateDraftGraph(draftGraphId: string, graphJson: GraphData): Promise<DraftGraphResponse> {
  const res = await api.put<DraftGraphResponse>(`/draft-graphs/${draftGraphId}`, {
    graph_json: graphJson,
  });
  return res.data;
}

export async function confirmDraftGraph(draftGraphId: string): Promise<ConfirmResponse> {
  const res = await api.post<ConfirmResponse>(`/draft-graphs/${draftGraphId}/confirm`);
  return res.data;
}

// ── Insertion Proposals ──

export async function getInsertionProposal(proposalId: string): Promise<InsertionProposalResponse> {
  const res = await api.get<InsertionProposalResponse>(`/insertion-proposals/${proposalId}`);
  return res.data;
}

export async function updateInsertionProposal(proposalId: string, proposalJson: unknown): Promise<InsertionProposalResponse> {
  const res = await api.put<InsertionProposalResponse>(`/insertion-proposals/${proposalId}`, {
    proposal_json: proposalJson,
  });
  return res.data;
}

export async function applyInsertionProposal(proposalId: string): Promise<ApplyResponse> {
  const res = await api.post<ApplyResponse>(`/insertion-proposals/${proposalId}/apply`);
  return res.data;
}

// ── Clustering Proposals ──

export async function getClusteringProposal(proposalId: string): Promise<ClusteringProposalResponse> {
  const res = await api.get<ClusteringProposalResponse>(`/clustering-proposals/${proposalId}`);
  return res.data;
}

export async function updateClusteringProposal(
  proposalId: string,
  proposalJson: ClusteringProposalJSON,
): Promise<ClusteringProposalResponse> {
  const res = await api.put<ClusteringProposalResponse>(`/clustering-proposals/${proposalId}`, proposalJson);
  return res.data;
}

export async function applyClusteringProposal(proposalId: string): Promise<ApplyResponse> {
  const res = await api.post<ApplyResponse>(`/clustering-proposals/${proposalId}/apply`);
  return res.data;
}

// ── Global Graph ──

export async function getGlobalGraph(filterType: 'all' | 'topic' | 'article' | 'partition' = 'all') {
  const res = await api.get('/graph/global', { params: { filter_type: filterType } });
  return res.data;
}

// ── Graph ──

export async function getLocalGraph(nodeId: string, hops = 1) {
  const res = await api.get('/graph/local', { params: { node_id: nodeId, hops } });
  return res.data;
}

export async function getNodeDetail(nodeId: string) {
  const res = await api.get(`/graph/nodes/${nodeId}`);
  return res.data;
}

// ── Extraction Steps ──

export async function getExtractionStatus(documentId: string) {
  const res = await api.get(`/extraction/${documentId}/status`);
  return res.data;
}

export async function runStep1(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/step1`);
  return res.data;
}

export async function saveStep1(documentId: string, data: unknown) {
  const res = await api.put(`/extraction/${documentId}/step1`, data);
  return res.data;
}

export async function runStep2(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/step2`);
  return res.data;
}

export async function saveStep2(documentId: string, data: unknown) {
  const res = await api.put(`/extraction/${documentId}/step2`, data);
  return res.data;
}

export async function streamStep2(
  documentId: string,
  onChunk: (text: string) => void,
): Promise<{ session_id: string; step: number; data: { nodes: unknown[]; edges: unknown[] } }> {
  const response = await fetch(`/api/extraction/${documentId}/step2/stream`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { session_id: string; step: number; data: { nodes: unknown[]; edges: unknown[] } } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch {
        // Ignore unparseable SSE lines (partial chunks, keepalives)
        continue;
      }
      if (msg.type === 'chunk') {
        onChunk(msg.text);
      } else if (msg.type === 'done') {
        result = msg.result;
      } else if (msg.type === 'error') {
        throw new Error(msg.message || 'Stream error');
      }
    }
  }

  if (!result) throw new Error('Stream ended without result');
  return result;
}

export async function finalizeExtraction(documentId: string) {
  const res = await api.post(`/extraction/${documentId}/finalize`);
  return res.data;
}

// ── Search ──

export async function semanticSearch(query: string, topK = 10): Promise<SearchResult> {
  const res = await api.post<SearchResult>('/search/semantic', { query, top_k: topK });
  return res.data;
}

export async function graphEnhancedSearch(query: string, topK = 10): Promise<SearchResult & { graph_context?: GraphData }> {
  const res = await api.post('/search/graph-enhanced', { query, top_k: topK });
  return res.data;
}

// ── QA ──

export async function askQuestion(question: string): Promise<AskResponse> {
  const res = await api.post<AskResponse>('/qa/ask', { question });
  return res.data;
}

// ── Partitions ──

export async function listPartitions() {
  const res = await api.get('/partitions');
  return res.data;
}

export async function createPartition(name: string, description: string = '') {
  const res = await api.post('/partitions', { name, description });
  return res.data;
}

export async function updatePartition(partitionId: string, data: { name?: string; description?: string }) {
  const res = await api.put(`/partitions/${partitionId}`, data);
  return res.data;
}

export async function deletePartition(partitionId: string) {
  const res = await api.delete(`/partitions/${partitionId}`);
  return res.data;
}

export async function getPartitionChildren(partitionId: string) {
  const res = await api.get(`/partitions/${partitionId}/children`);
  return res.data;
}

export async function mergePartitions(sourceId: string, targetId: string) {
  const res = await api.post('/partitions/merge', { source_id: sourceId, target_id: targetId });
  return res.data;
}

export async function splitPartition(
  partitionId: string,
  topicIds: string[],
  newPartitionName: string,
  newPartitionDescription: string = '',
) {
  const res = await api.post(`/partitions/${partitionId}/split`, {
    topic_ids: topicIds,
    new_partition_name: newPartitionName,
    new_partition_description: newPartitionDescription,
  });
  return res.data;
}

// ── Merge / Dedup ──

export async function detectDuplicateTopics(threshold: number = 0.85) {
  const res = await api.get('/graph/duplicates', { params: { threshold } });
  return res.data;
}

export async function mergeNodes(sourceId: string, targetId: string) {
  const res = await api.post('/graph/nodes/merge', { source_id: sourceId, target_id: targetId });
  return res.data;
}

// ── Evaluation ──

export async function runEvaluation(documentId: string, strategies: string[] = ['concise', 'standard', 'detailed']) {
  const res = await api.post('/evaluation/run', { document_id: documentId, strategies });
  return res.data;
}
