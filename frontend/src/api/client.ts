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

export async function getGlobalGraph(filterType: 'all' | 'topic' | 'article' = 'all') {
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
