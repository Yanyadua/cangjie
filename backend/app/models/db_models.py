import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Float, Integer, DateTime, ForeignKey, JSON,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from ..database import Base


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(Text, nullable=False)
    source_type = Column(Text)
    source_url = Column(Text)
    author = Column(Text)
    raw_content = Column(Text, nullable=False)
    cleaned_content = Column(Text)
    content_hash = Column(Text, nullable=False)
    summary = Column(Text)
    status = Column(Text, nullable=False, default="draft")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")
    draft_graphs = relationship("DraftGraph", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    content_hash = Column(Text, nullable=False)
    embedding = Column(Text)
    token_count = Column(Integer)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    document = relationship("Document", back_populates="chunks")


class Node(Base):
    __tablename__ = "nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_type = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    canonical_name = Column(Text)
    description = Column(Text)
    source_document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"))
    embedding = Column(Text)
    status = Column(Text, nullable=False, default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    aliases = relationship("NodeAlias", back_populates="node", cascade="all, delete-orphan")
    source_edges = relationship("Edge", foreign_keys="Edge.source_node_id", back_populates="source_node")
    target_edges = relationship("Edge", foreign_keys="Edge.target_node_id", back_populates="target_node")


class NodeAlias(Base):
    __tablename__ = "node_aliases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    alias = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    node = relationship("Node", back_populates="aliases")


class Edge(Base):
    __tablename__ = "edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    relation_type = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False, default=1.0)
    evidence_document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"))
    evidence_chunk_id = Column(UUID(as_uuid=True), ForeignKey("chunks.id"))
    evidence_text = Column(Text)
    status = Column(Text, nullable=False, default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    source_node = relationship("Node", foreign_keys=[source_node_id], back_populates="source_edges")
    target_node = relationship("Node", foreign_keys=[target_node_id], back_populates="target_edges")


class DraftGraph(Base):
    __tablename__ = "draft_graphs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    graph_json = Column(JSONB, nullable=False)
    status = Column(Text, nullable=False, default="draft")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    document = relationship("Document", back_populates="draft_graphs")


class GraphPatch(Base):
    __tablename__ = "graph_patches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"))
    patch_type = Column(Text, nullable=False)
    operations = Column(JSONB, nullable=False)
    status = Column(Text, nullable=False, default="pending")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    applied_at = Column(DateTime)


class InsertionProposal(Base):
    __tablename__ = "insertion_proposals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    proposal_json = Column(JSONB, nullable=False)
    status = Column(Text, nullable=False, default="pending")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
