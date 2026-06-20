export type DocumentImportRequest = {
  title: string;
  source_type?: string;
  source_url?: string;
  author?: string;
  content: string;
};

export type ImportResponse = {
  document_id: string;
  draft_graph_id: string;
  summary: string;
};

export type ConfirmResponse = {
  draft_graph_id: string;
  status: string;
  proposal_id: string | null;
  error?: string;
};

export type ApplyResponse = {
  status: string;
  patch_id?: string;
  operations_count?: number;
  errors?: string[];
  error?: string;
  // Phase 2 fields (returned by apply_proposal)
  article_node_id?: string;
  applied?: string[];
  failed?: string[];
  knowledge_nodes_created?: Record<string, number>;
  knowledge_edges_created?: number;
};

export type AskRequest = {
  question: string;
};

export type AskResponse = {
  answer: string;
  evidence: Array<{
    source: string;
    text: string;
    document_title?: string;
  }>;
};
