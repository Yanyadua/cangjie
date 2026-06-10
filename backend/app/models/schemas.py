from __future__ import annotations
from typing import Optional, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field


# ── Node / Edge / Graph ──

NODE_TYPES = [
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology", "question", "chunk",
]

RELATION_TYPES = [
    "related_to", "contains", "part_of", "supports", "contradicts",
    "depends_on", "implements", "improves", "causes", "compares_with",
    "derived_from", "used_for", "evidence_for", "mentions", "similar_to", "belongs_to",
]


class GraphNode(BaseModel):
    id: str
    nodeType: str = Field(alias="node_type")
    name: str
    description: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    isDraft: Optional[bool] = None

    class Config:
        populate_by_name = True


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relationType: str = Field(alias="relation_type")
    confidence: Optional[float] = None
    evidence: Optional[str] = None

    class Config:
        populate_by_name = True


class GraphData(BaseModel):
    summary: Optional[str] = None
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []


# ── Document ──

class DocumentImport(BaseModel):
    title: str
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    content: str


class DocumentResponse(BaseModel):
    id: UUID
    title: str
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    summary: Optional[str] = None
    status: str
    created_at: datetime


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int


# ── Draft Graph ──

class DraftGraphResponse(BaseModel):
    id: UUID
    document_id: UUID
    graph_json: GraphData
    status: str


class DraftGraphUpdateRequest(BaseModel):
    graph_json: GraphData


# ── Insertion Proposal ──

class CandidatePosition(BaseModel):
    target_node_id: str
    target_node_name: str
    reason: str
    score: float


class SuggestedMerge(BaseModel):
    draft_node_temp_id: str
    existing_node_id: str
    reason: str
    confidence: float


class SuggestedEdge(BaseModel):
    source: str
    target: str
    relation_type: str
    reason: str
    confidence: float


class InsertionProposalJSON(BaseModel):
    candidate_positions: list[CandidatePosition] = []
    suggested_merges: list[SuggestedMerge] = []
    suggested_edges: list[SuggestedEdge] = []
    possible_conflicts: list[Any] = []


class InsertionProposalResponse(BaseModel):
    id: UUID
    document_id: UUID
    proposal_json: InsertionProposalJSON
    status: str


class InsertionProposalUpdateRequest(BaseModel):
    proposal_json: InsertionProposalJSON


# ── Node / Edge detail ──

class NodeResponse(BaseModel):
    id: UUID
    node_type: str
    name: str
    canonical_name: Optional[str] = None
    description: Optional[str] = None
    status: str


class NodeDetailResponse(BaseModel):
    id: UUID
    node_type: str
    name: str
    canonical_name: Optional[str] = None
    description: Optional[str] = None
    aliases: list[str] = []
    related_documents: list[DocumentResponse] = []
    in_edges: list[GraphEdge] = []
    out_edges: list[GraphEdge] = []


# ── Patch ──

class PatchOperation(BaseModel):
    op: str
    node: Optional[dict] = None
    draft_node_temp_id: Optional[str] = None
    existing_node_id: Optional[str] = None
    source: Optional[str] = None
    target: Optional[str] = None
    relation_type: Optional[str] = None
    confidence: Optional[float] = None
    evidence_text: Optional[str] = None
    reason: Optional[str] = None


class GraphPatchResponse(BaseModel):
    id: UUID
    document_id: Optional[UUID] = None
    patch_type: str
    operations: list[PatchOperation]
    status: str


# ── Search ──

class SemanticSearchRequest(BaseModel):
    query: str
    top_k: int = 10


class ChunkSearchResult(BaseModel):
    id: UUID
    document_id: UUID
    content: str
    score: float


class SemanticSearchResponse(BaseModel):
    chunks: list[ChunkSearchResult] = []
    nodes: list[NodeResponse] = []
    documents: list[DocumentResponse] = []


class GraphEnhancedSearchRequest(BaseModel):
    query: str
    top_k: int = 10


class GraphEnhancedSearchResponse(BaseModel):
    chunks: list[ChunkSearchResult] = []
    nodes: list[NodeResponse] = []
    documents: list[DocumentResponse] = []
    graph_context: Optional[GraphData] = None


# ── QA ──

class AskRequest(BaseModel):
    question: str


class EvidenceCitation(BaseModel):
    source: str
    text: str
    document_title: Optional[str] = None


class AskResponse(BaseModel):
    answer: str
    evidence: list[EvidenceCitation] = []
