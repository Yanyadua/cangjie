# Global Knowledge Network Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dual-layer global knowledge network where articles are nodes connected through AI-discovered topic clusters, with human-in-the-loop confirmation.

**Architecture:** Two-layer graph (topic + article nodes). After article extraction, LLM generates tags → semantic match against existing topics → generate clustering proposal → user confirms → write to global graph. Reuses existing vector_store, graph_store, entity_resolution modules.

**Tech Stack:** FastAPI, SQLAlchemy async, pgvector, React + TypeScript, ReactFlow

**Design doc:** `docs/plans/2026-06-11-global-knowledge-network-design.md`

---

### Task 1: Backend — Tag Generator Module

**Files:**
- Create: `backend/app/core/tag_generator.py`

**Step 1: Create tag_generator.py**

```python
"""
Tag generator for the Global Knowledge Network.

Takes article summary + core concepts from extraction stage 1,
calls LLM to generate 3-5 topic tags.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .llm_client import LLMClient

logger = logging.getLogger(__name__)

_TAG_SYSTEM_PROMPT = (
    "你是一个个人知识库的主题标签生成模块。\n"
    "\n"
    "你将收到：\n"
    "1. 文章摘要\n"
    "2. 文章的核心概念列表\n"
    "\n"
    "请为这篇文章生成 3-5 个主题标签。每个标签代表这篇文章在个人知识网络中应该归属的主题域。\n"
    "\n"
    "要求：\n"
    "- 标签应覆盖文章的主要知识领域，而非具体实体\n"
    "- 优先使用已有的常见知识领域名称（如'机器学习'、'智能体评测'、'前端开发'）\n"
    "- 避免过于宽泛（如'技术'）或过于狭窄（如'2024年某论文的某个实验'）\n"
    "\n"
    "输出严格 JSON，不要输出 Markdown，不要输出解释文字。\n"
    "\n"
    "JSON 格式：\n"
    "{\n"
    '  "tags": [\n'
    "    {\n"
    '      "name": "标签名称",\n'
    '      "confidence": 0.0,\n'
    '      "reason": "为什么这个标签适合这篇文章"\n'
    "    }\n"
    "  ]\n"
    "}"
)

_TAG_FEWHOT_INPUT = """文章摘要：本文介绍了微软研究院提出的 GraphRAG 方法，通过知识图谱和社区检测改进传统 RAG 的全局推理能力。

核心概念：
- GraphRAG（method）：微软研究院提出的基于知识图谱的检索增强生成方法
- 知识图谱（concept）：GraphRAG 的基础数据结构
- 社区检测（method）：将知识图谱划分为局部子图的算法
- Leiden 算法（method）：社区检测算法
- 传统 RAG（concept）：基于向量相似度的检索增强生成方法"""

_TAG_FEWSHOT_OUTPUT = json.dumps({
    "tags": [
        {"name": "知识图谱", "confidence": 0.95, "reason": "文章核心主题是基于知识图谱的检索增强方法"},
        {"name": "检索增强生成", "confidence": 0.92, "reason": "GraphRAG 是 RAG 的改进方法"},
        {"name": "社区检测", "confidence": 0.85, "reason": "社区检测是 GraphRAG 的关键技术组件"},
        {"name": "自然语言处理", "confidence": 0.7, "reason": "GraphRAG 属于 NLP 领域的应用研究"},
    ]
}, ensure_ascii=False, indent=2)


class TagGenerator:
    """Generate topic tags for articles using LLM."""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def generate_tags(
        self,
        summary: str,
        core_concepts: list[dict[str, str]],
    ) -> list[dict[str, Any]]:
        """Generate topic tags from article summary and core concepts.

        Args:
            summary: Article summary from extraction stage 1.
            core_concepts: List of {name, type, description} dicts from stage 1.

        Returns:
            List of {name, confidence, reason} dicts.
        """
        concepts_text = "\n".join(
            f"- {c['name']}（{c.get('type', 'concept')}）：{c.get('description', '')}"
            for c in core_concepts
        )

        user_prompt = f"文章摘要：{summary}\n\n核心概念：\n{concepts_text}"

        system_prompt = (
            _TAG_SYSTEM_PROMPT
            + "\n\n示例输入：\n" + _TAG_FEWHOT_INPUT
            + "\n\n示例输出：\n" + _TAG_FEWSHOT_OUTPUT
        )

        raw = await self.llm.generate_json(system_prompt, user_prompt)

        tags = raw.get("tags", [])
        # Sanitize: ensure required fields
        valid_tags = []
        for t in tags:
            if not isinstance(t, dict) or "name" not in t:
                continue
            valid_tags.append({
                "name": str(t["name"]).strip(),
                "confidence": min(1.0, max(0.0, float(t.get("confidence", 0.5)))),
                "reason": str(t.get("reason", "")),
            })

        # Deduplicate by name (keep highest confidence)
        seen: dict[str, dict] = {}
        for t in valid_tags:
            key = t["name"].lower()
            if key not in seen or t["confidence"] > seen[key]["confidence"]:
                seen[key] = t

        return list(seen.values())[:5]
```

**Step 2: Verify the file imports correctly**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.core.tag_generator import TagGenerator; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/core/tag_generator.py
git commit -m "feat: add tag generator module for global knowledge network"
```

---

### Task 2: Backend — Clustering Planner (rewrite insertion_planner)

**Files:**
- Create: `backend/app/core/clustering_planner.py`

**Step 1: Create clustering_planner.py**

This replaces `insertion_planner.py`. It takes tags from TagGenerator, matches them against existing topic nodes via vector search, and generates a clustering proposal.

```python
"""
Clustering planner for the Global Knowledge Network.

Takes generated tags and matches them against existing topic nodes
in the global graph to produce a clustering proposal.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from .llm_client import LLMClient
from .embedding_client import EmbeddingClient
from .vector_store import VectorStore
from .graph_store import GraphStore

logger = logging.getLogger(__name__)

_TOP_K = 3
_SIMILARITY_THRESHOLD = 0.8
_MERGE_THRESHOLD = 0.85

_CLUSTERING_SYSTEM_PROMPT = (
    "你是一个个人知识库的主题聚类规划模块。\n"
    "\n"
    "你将收到：\n"
    "1. 新文章的标题和摘要\n"
    "2. AI 生成的主题标签列表\n"
    "3. 每个标签在全局图谱中匹配到的已有 topic 节点（按相似度排序）\n"
    "4. 已有 topic 节点之间的现有关系\n"
    "\n"
    "请为每个标签决定操作：\n"
    "- MERGE：与已有 topic 合并（当语义高度一致时）\n"
    "- NEW：创建新 topic 节点（当没有足够相似的已有 topic 时）\n"
    "\n"
    "同时检测 topic 之间的关系，建议新增的 topic 间边。\n"
    "\n"
    "输出严格 JSON，不要输出 Markdown。\n"
    "\n"
    "JSON 格式：\n"
    "{\n"
    '  "tag_actions": [\n'
    "    {\n"
    '      "tag_name": "标签名",\n'
    '      "action": "MERGE" | "NEW",\n'
    '      "target_topic_id": "已有节点ID（仅MERGE时）",\n'
    '      "confidence": 0.0,\n'
    '      "reason": "决策原因"\n'
    "    }\n"
    "  ],\n"
    '  "new_topic_descriptions": {\n'
    '    "标签名": "新topic的描述"\n'
    "  },\n"
    '  "topic_edges": [\n'
    "    {\n"
    '      "source_tag": "标签名或已有topic名",\n'
    '      "target_tag": "标签名或已有topic名",\n'
    '      "relation_type": "related_to" | "contains" | "part_of",\n'
    '      "reason": "关系原因"\n'
    "    }\n"
    "  ]\n"
    "}"
)


class ClusteringPlanner:
    """Plan how to integrate a new article's tags into the global topic graph."""

    def __init__(
        self,
        llm: LLMClient,
        embedding: EmbeddingClient,
        vector_store: VectorStore,
        graph_store: GraphStore,
    ):
        self.llm = llm
        self.embedding = embedding
        self.vector_store = vector_store
        self.graph_store = graph_store

    async def generate_proposal(
        self,
        article_title: str,
        article_summary: str,
        tags: list[dict[str, Any]],
        document_id: str,
    ) -> dict[str, Any]:
        """Generate a clustering proposal for the article's tags.

        Args:
            article_title: Article title.
            article_summary: Article summary from extraction.
            tags: List of {name, confidence, reason} from TagGenerator.
            document_id: Source document UUID.

        Returns:
            Clustering proposal dict with tag_actions, new_topic_descriptions,
            topic_edges, and article_node info.
        """
        # Step 1: For each tag, search for similar topic nodes
        tag_matches: dict[str, list[dict]] = {}
        for tag in tags:
            tag_name = tag["name"]
            try:
                tag_emb = await self.embedding.embed(tag_name)
                matches = await self.vector_store.search_nodes(
                    query_embedding=tag_emb,
                    top_k=_TOP_K,
                    node_type="topic",
                )
                # Filter by similarity threshold
                tag_matches[tag_name] = [
                    m for m in matches if m["score"] >= _SIMILARITY_THRESHOLD
                ]
            except Exception as e:
                logger.warning(f"Vector search failed for tag '{tag_name}': {e}")
                tag_matches[tag_name] = []

        # Step 2: Get existing topic-topic edges for context
        all_topic_nodes = await self.graph_store.get_all_active_nodes()
        topic_ids = [n["id"] for n in all_topic_nodes if n["node_type"] == "topic"]
        existing_edges = []
        if topic_ids:
            from uuid import UUID
            topic_uuids = [UUID(tid) for tid in topic_ids]
            existing_edges = await self.graph_store.get_edges_for_nodes(topic_uuids)

        # Step 3: Build context for LLM
        tags_with_matches = []
        for tag in tags:
            name = tag["name"]
            matches = tag_matches.get(name, [])
            tags_with_matches.append({
                "name": name,
                "confidence": tag["confidence"],
                "matches": [
                    {
                        "id": m["id"],
                        "name": m["name"],
                        "description": m.get("description", ""),
                        "similarity": round(m["score"], 3),
                    }
                    for m in matches
                ],
            })

        existing_edges_info = [
            {
                "source": e["source"],
                "target": e["target"],
                "relation_type": e["relation_type"],
            }
            for e in existing_edges
            if e["relation_type"] in ("related_to", "contains", "part_of")
        ]

        user_prompt = json.dumps({
            "article_title": article_title,
            "article_summary": article_summary,
            "tags_with_matches": tags_with_matches,
            "existing_topic_edges": existing_edges_info,
        }, ensure_ascii=False, indent=2)

        # Step 4: Call LLM
        raw = await self.llm.generate_json(_CLUSTERING_SYSTEM_PROMPT, user_prompt)

        # Step 5: Build proposal
        proposal = self._build_proposal(raw, tags, tag_matches, article_title, article_summary, document_id)

        return proposal

    def _build_proposal(
        self,
        llm_result: dict,
        tags: list[dict],
        tag_matches: dict[str, list[dict]],
        article_title: str,
        article_summary: str,
        document_id: str,
    ) -> dict[str, Any]:
        """Build the final proposal from LLM result and match data."""

        tag_actions = llm_result.get("tag_actions", [])
        new_topic_descriptions = llm_result.get("new_topic_descriptions", {})
        topic_edges = llm_result.get("topic_edges", [])

        # Validate and enrich tag_actions with match details
        validated_actions = []
        for action in tag_actions:
            tag_name = action.get("tag_name", "")
            act = action.get("action", "NEW").upper()
            confidence = action.get("confidence", 0.5)

            if act == "MERGE":
                target_id = action.get("target_topic_id", "")
                # Verify the target exists in matches
                matches = tag_matches.get(tag_name, [])
                matched_names = [
                    {"id": m["id"], "name": m["name"], "similarity": m["score"]}
                    for m in matches
                ]
                validated_actions.append({
                    "tag_name": tag_name,
                    "action": "MERGE",
                    "target_topic_id": target_id,
                    "confidence": confidence,
                    "reason": action.get("reason", ""),
                    "matched_candidates": matched_names,
                })
            else:
                validated_actions.append({
                    "tag_name": tag_name,
                    "action": "NEW",
                    "target_topic_id": None,
                    "confidence": confidence,
                    "reason": action.get("reason", ""),
                    "proposed_description": new_topic_descriptions.get(tag_name, ""),
                    "temp_id": f"t_{uuid4().hex[:8]}",
                })

        # Add tags not covered by LLM (fallback)
        covered_tags = {a["tag_name"] for a in validated_actions}
        for tag in tags:
            if tag["name"] not in covered_tags:
                matches = tag_matches.get(tag["name"], [])
                if matches and matches[0]["score"] >= _MERGE_THRESHOLD:
                    validated_actions.append({
                        "tag_name": tag["name"],
                        "action": "MERGE",
                        "target_topic_id": matches[0]["id"],
                        "confidence": matches[0]["score"],
                        "reason": f"语义相似度 {matches[0]['score']:.2f}，自动建议合并",
                        "matched_candidates": [
                            {"id": m["id"], "name": m["name"], "similarity": m["score"]}
                            for m in matches
                        ],
                    })
                else:
                    validated_actions.append({
                        "tag_name": tag["name"],
                        "action": "NEW",
                        "target_topic_id": None,
                        "confidence": tag["confidence"],
                        "reason": "未找到足够相似的已有topic",
                        "proposed_description": "",
                        "temp_id": f"t_{uuid4().hex[:8]}",
                    })

        return {
            "article_title": article_title,
            "article_summary": article_summary,
            "document_id": document_id,
            "tag_actions": validated_actions,
            "topic_edges": topic_edges,
        }
```

**Step 2: Verify import**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.core.clustering_planner import ClusteringPlanner; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/core/clustering_planner.py
git commit -m "feat: add clustering planner for tag-based topic matching"
```

---

### Task 3: Backend — Update Pydantic Schemas

**Files:**
- Modify: `backend/app/models/schemas.py`

**Step 1: Add new schema types after the existing `InsertionProposalUpdateRequest` class**

Add these new types:

```python
# ── Clustering Proposal ──

class TagAction(BaseModel):
    tag_name: str
    action: str  # "MERGE" or "NEW"
    target_topic_id: Optional[str] = None
    confidence: float = 0.5
    reason: str = ""
    matched_candidates: list[dict[str, Any]] = []
    proposed_description: Optional[str] = None
    temp_id: Optional[str] = None


class TopicEdgeProposal(BaseModel):
    source_tag: str
    target_tag: str
    relation_type: str = "related_to"
    reason: str = ""


class ClusteringProposalJSON(BaseModel):
    article_title: str
    article_summary: str
    document_id: str
    tag_actions: list[TagAction] = []
    topic_edges: list[TopicEdgeProposal] = []


class ClusteringProposalResponse(BaseModel):
    id: UUID
    document_id: UUID
    proposal_json: ClusteringProposalJSON
    status: str


class ClusteringProposalUpdateRequest(BaseModel):
    proposal_json: ClusteringProposalJSON
```

**Step 2: Verify**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.models.schemas import ClusteringProposalJSON, ClusteringProposalResponse; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/models/schemas.py
git commit -m "feat: add clustering proposal schemas"
```

---

### Task 4: Backend — Clustering Service

**Files:**
- Create: `backend/app/services/clustering_service.py`

**Step 1: Create clustering_service.py**

```python
"""Service for managing clustering proposals and applying them to the global graph."""

import json
import logging
from uuid import uuid4
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from ..models.db_models import InsertionProposal, Document
from ..core.llm_client import LLMClient
from ..core.embedding_client import EmbeddingClient
from ..core.tag_generator import TagGenerator
from ..core.clustering_planner import ClusteringPlanner
from ..core.vector_store import VectorStore
from ..core.graph_store import GraphStore

logger = logging.getLogger(__name__)


class ClusteringService:
    """Orchestrate tag generation, clustering proposal, and application."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.llm = LLMClient()
        self.embedding = EmbeddingClient()
        self.tag_generator = TagGenerator(self.llm)
        self.vector_store = VectorStore(db)
        self.graph_store = GraphStore(db)
        self.planner = ClusteringPlanner(
            self.llm, self.embedding, self.vector_store, self.graph_store
        )

    async def generate_proposal(self, document_id: str, draft_graph_json: dict) -> dict:
        """Generate a clustering proposal for a confirmed draft graph.

        Args:
            document_id: UUID of the source document.
            draft_graph_json: The confirmed draft graph JSON with stage1 data.

        Returns:
            Dict with proposal_id and proposal data.
        """
        # Get document info
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return {"error": "Document not found"}

        title = doc.title
        # Extract summary and concepts from draft graph
        stage1 = draft_graph_json.get("stage1", {})
        summary = stage1.get("summary", doc.summary or "")
        core_concepts = stage1.get("core_concepts", [])

        # Step 1: Generate tags
        tags = await self.tag_generator.generate_tags(summary, core_concepts)
        if not tags:
            return {"error": "Failed to generate tags"}

        # Step 2: Generate clustering proposal
        proposal = await self.planner.generate_proposal(
            article_title=title,
            article_summary=summary,
            tags=tags,
            document_id=document_id,
        )

        # Step 3: Store proposal in DB (reuse insertion_proposals table)
        db_proposal = InsertionProposal(
            id=uuid4(),
            document_id=document_id,
            proposal_json=proposal,
            status="pending",
        )
        self.db.add(db_proposal)
        await self.db.flush()

        return {
            "proposal_id": str(db_proposal.id),
            "proposal_json": proposal,
        }

    async def get_proposal(self, proposal_id: str) -> Optional[dict]:
        """Get a clustering proposal by ID."""
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return None
        return {
            "id": str(prop.id),
            "document_id": str(prop.document_id),
            "proposal_json": prop.proposal_json,
            "status": prop.status,
        }

    async def update_proposal(self, proposal_id: str, proposal_json: dict) -> Optional[dict]:
        """Update a clustering proposal (after user edits)."""
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return None

        prop.proposal_json = json.loads(json.dumps(proposal_json))
        flag_modified(prop, "proposal_json")
        await self.db.flush()

        return {
            "id": str(prop.id),
            "document_id": str(prop.document_id),
            "proposal_json": prop.proposal_json,
            "status": prop.status,
        }

    async def apply_proposal(self, proposal_id: str) -> dict:
        """Apply a confirmed clustering proposal to the global graph.

        Creates topic nodes, article node, tag edges, and topic-topic edges.
        """
        result = await self.db.execute(
            select(InsertionProposal).where(InsertionProposal.id == proposal_id)
        )
        prop = result.scalar_one_or_none()
        if not prop:
            return {"error": "Proposal not found"}

        proposal = prop.proposal_json
        document_id = proposal["document_id"]
        tag_actions = proposal.get("tag_actions", [])
        topic_edges = proposal.get("topic_edges", [])

        # Map: tag_name -> topic_node_id (resolved after creation/merge)
        tag_to_topic_id: dict[str, str] = {}
        applied = []
        failed = []

        # Step 1: Process each tag action
        for action in tag_actions:
            try:
                if action["action"] == "NEW":
                    # Create new topic node
                    topic_id = await self.graph_store.create_node(
                        node_type="topic",
                        name=action["tag_name"],
                        description=action.get("proposed_description", ""),
                    )
                    # Generate and store embedding
                    try:
                        emb = await self.embedding.embed(action["tag_name"])
                        await self.vector_store.upsert_node_embedding(topic_id, emb)
                    except Exception as e:
                        logger.warning(f"Topic embedding failed: {e}")

                    tag_to_topic_id[action["tag_name"]] = str(topic_id)
                    applied.append(f"NEW topic: {action['tag_name']}")

                elif action["action"] == "MERGE" and action.get("target_topic_id"):
                    # Tag links to existing topic
                    tag_to_topic_id[action["tag_name"]] = action["target_topic_id"]
                    applied.append(f"MERGE tag '{action['tag_name']}' -> existing topic")

            except Exception as e:
                failed.append(f"Tag '{action['tag_name']}': {e}")
                logger.error(f"Failed to process tag action: {e}")

        # Step 2: Create article node
        try:
            article_id = await self.graph_store.create_node(
                node_type="article",
                name=proposal.get("article_title", "Untitled"),
                description=proposal.get("article_summary", ""),
                source_document_id=document_id,
            )
            # Generate embedding for article
            try:
                emb = await self.embedding.embed(
                    proposal.get("article_summary", proposal.get("article_title", ""))
                )
                await self.vector_store.upsert_node_embedding(article_id, emb)
            except Exception as e:
                logger.warning(f"Article embedding failed: {e}")

            applied.append(f"NEW article node: {proposal.get('article_title')}")
        except Exception as e:
            failed.append(f"Article node creation: {e}")
            return {"error": "Failed to create article node", "details": str(e), "applied": applied, "failed": failed}

        # Step 3: Create article --tag--> topic edges
        for tag_name, topic_id in tag_to_topic_id.items():
            try:
                await self.graph_store.create_edge(
                    source_id=article_id,
                    target_id=topic_id,
                    relation_type="tag",
                    confidence=1.0,
                    evidence_document_id=document_id,
                )
                applied.append(f"EDGE article -> {tag_name}")
            except Exception as e:
                failed.append(f"Edge article->{tag_name}: {e}")

        # Step 4: Create topic-topic edges (if both topics exist)
        for edge in topic_edges:
            source_tag = edge.get("source_tag", "")
            target_tag = edge.get("target_tag", "")
            source_id = tag_to_topic_id.get(source_tag)
            target_id = tag_to_topic_id.get(target_tag)

            if source_id and target_id and source_id != target_id:
                try:
                    from uuid import UUID
                    await self.graph_store.create_edge(
                        source_id=UUID(source_id),
                        target_id=UUID(target_id),
                        relation_type=edge.get("relation_type", "related_to"),
                        confidence=0.8,
                    )
                    applied.append(f"EDGE topic {source_tag} --{edge.get('relation_type')}--> {target_tag}")
                except Exception as e:
                    failed.append(f"Topic edge {source_tag}->{target_tag}: {e}")

        # Step 5: Update proposal status
        prop.status = "applied"
        flag_modified(prop, "status")
        await self.db.flush()

        return {
            "status": "applied",
            "article_node_id": str(article_id),
            "applied": applied,
            "failed": failed,
        }
```

**Step 2: Verify import**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.services.clustering_service import ClusteringService; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/clustering_service.py
git commit -m "feat: add clustering service for proposal generation and application"
```

---

### Task 5: Backend — Update API Routes

**Files:**
- Create: `backend/app/api/clustering.py`

**Step 1: Create clustering API router**

```python
"""API routes for clustering proposals."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services.clustering_service import ClusteringService

router = APIRouter()


@router.get("/clustering-proposals/{proposal_id}")
async def get_clustering_proposal(proposal_id: str, db: AsyncSession = Depends(get_db)):
    service = ClusteringService(db)
    result = await service.get_proposal(proposal_id)
    if not result:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return result


@router.put("/clustering-proposals/{proposal_id}")
async def update_clustering_proposal(
    proposal_id: str,
    proposal_json: dict,
    db: AsyncSession = Depends(get_db),
):
    service = ClusteringService(db)
    result = await service.update_proposal(proposal_id, proposal_json)
    if not result:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return result


@router.post("/clustering-proposals/{proposal_id}/apply")
async def apply_clustering_proposal(proposal_id: str, db: AsyncSession = Depends(get_db)):
    service = ClusteringService(db)
    result = await service.apply_proposal(proposal_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
```

**Step 2: Register router in main.py**

Add to `backend/app/main.py`:

After `from .api import documents, draft_graphs, insertion, graph, search, qa, extraction` add `clustering`:

```python
from .api import documents, draft_graphs, insertion, graph, search, qa, extraction, clustering
```

After `app.include_router(extraction.router, prefix="/api", tags=["extraction"])` add:

```python
app.include_router(clustering.router, prefix="/api", tags=["clustering"])
```

**Step 3: Verify**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.api.clustering import router; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/api/clustering.py backend/app/main.py
git commit -m "feat: add clustering API routes"
```

---

### Task 6: Backend — Update DraftGraph Confirm Flow

**Files:**
- Modify: `backend/app/services/draft_graph_service.py`

**Step 1: Update confirm_draft_graph method**

The `confirm_draft_graph` method in `DraftGraphService` currently calls `InsertionPlanner`. Update it to call `ClusteringService.generate_proposal` instead.

Find the `confirm_draft_graph` method and replace its body with:

```python
async def confirm_draft_graph(self, draft_graph_id: str) -> dict:
    """Confirm a draft graph and generate a clustering proposal."""
    result = await self.db.execute(
        select(DraftGraph).where(DraftGraph.id == draft_graph_id)
    )
    dg = result.scalar_one_or_none()
    if not dg:
        return {"error": "Draft graph not found"}

    dg.status = "confirmed"
    await self.db.flush()

    # Generate clustering proposal using the new ClusteringService
    from .clustering_service import ClusteringService
    clustering = ClusteringService(self.db)
    proposal_result = await clustering.generate_proposal(
        document_id=str(dg.document_id),
        draft_graph_json=dg.graph_json,
    )

    if "error" in proposal_result:
        return {
            "draft_graph_id": str(dg.id),
            "status": "confirmed",
            "proposal_id": None,
            "error": proposal_result["error"],
        }

    return {
        "draft_graph_id": str(dg.id),
        "status": "confirmed",
        "proposal_id": proposal_result["proposal_id"],
    }
```

**Important:** Remove the old imports of `InsertionPlanner`, `VectorStore`, `GraphStore` from the file's `__init__` if they were only used in confirm_draft_graph.

**Step 2: Verify**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.services.draft_graph_service import DraftGraphService; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/draft_graph_service.py
git commit -m "feat: update draft graph confirm to use clustering service"
```

---

### Task 7: Backend — Add Global Graph Query Endpoint

**Files:**
- Modify: `backend/app/api/graph.py`

**Step 1: Add endpoint to get full global graph**

Add to `backend/app/api/graph.py`:

```python
@router.get("/global")
async def get_global_graph(
    filter_type: str = "all",
    db: AsyncSession = Depends(get_db),
):
    """Get the full global graph or filter by node type (topic/article)."""
    store = GraphStore(db)

    all_nodes = await store.get_all_active_nodes()

    # Filter by type if requested
    if filter_type == "topic":
        nodes = [n for n in all_nodes if n["node_type"] == "topic"]
    elif filter_type == "article":
        nodes = [n for n in all_nodes if n["node_type"] == "article"]
    else:
        nodes = [n for n in all_nodes if n["node_type"] in ("topic", "article")]

    # Get edges between these nodes
    from uuid import UUID
    node_ids = [UUID(n["id"]) for n in nodes]
    edges = await store.get_edges_for_nodes(node_ids) if node_ids else []

    return {"nodes": nodes, "edges": edges}
```

Also add the necessary imports at the top of the file if not already present:
```python
from ..core.graph_store import GraphStore
```

**Step 2: Verify**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && python -c "from app.api.graph import router; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/api/graph.py
git commit -m "feat: add global graph query endpoint with type filtering"
```

---

### Task 8: Frontend — Update TypeScript Types

**Files:**
- Modify: `frontend/src/types/graph.ts`

**Step 1: Add clustering proposal types**

Add after the `InsertionProposalResponse` type:

```typescript
// ── Clustering Proposal ──

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
  tag_actions: TagAction[];
  topic_edges: TopicEdgeProposal[];
};

export type ClusteringProposalResponse = {
  id: string;
  document_id: string;
  proposal_json: ClusteringProposalJSON;
  status: string;
};
```

Also add `'tag'` to `RelationType` union type:

```typescript
export type RelationType =
  | 'tag'
  | 'related_to'
  // ... rest unchanged
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to new types (existing errors from other files are OK)

**Step 3: Commit**

```bash
git add frontend/src/types/graph.ts
git commit -m "feat: add clustering proposal TypeScript types"
```

---

### Task 9: Frontend — Update API Client

**Files:**
- Modify: `frontend/src/api/client.ts`

**Step 1: Add clustering API functions**

Add after the `applyInsertionProposal` function:

```typescript
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
```

Add import at the top:
```typescript
import type { ClusteringProposalJSON, ClusteringProposalResponse } from '../types/graph';
```

**Step 2: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add clustering proposal API client functions"
```

---

### Task 10: Frontend — ClusteringProposalPage

**Files:**
- Create: `frontend/src/pages/ClusteringProposalPage.tsx`

**Step 1: Create the page**

```tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getClusteringProposal, updateClusteringProposal, applyClusteringProposal } from '../api/client';
import type { TagAction, ClusteringProposalJSON } from '../types/graph';

export default function ClusteringProposalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<ClusteringProposalJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [editedActions, setEditedActions] = useState<TagAction[]>([]);

  useEffect(() => {
    if (!id) return;
    getClusteringProposal(id)
      .then((res) => {
        setProposal(res.proposal_json);
        setEditedActions(res.proposal_json.tag_actions);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const toggleAction = (idx: number) => {
    setEditedActions(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      if (a.action === 'MERGE') {
        // Toggle to rejected (skip)
        return { ...a, action: 'NEW' as const, target_topic_id: undefined, temp_id: `t_${Date.now()}` };
      }
      return a;
    }));
  };

  const updateActionField = (idx: number, field: string, value: string) => {
    setEditedActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  const removeAction = (idx: number) => {
    setEditedActions(prev => prev.filter((_, i) => i !== idx));
  };

  const removeTopicEdge = (idx: number) => {
    if (!proposal) return;
    setProposal(prev => prev ? { ...prev, topic_edges: prev.topic_edges.filter((_, i) => i !== idx) } : prev);
  };

  const handleApply = async () => {
    if (!id || !proposal) return;
    setApplying(true);
    try {
      // First update with user edits
      const updated = { ...proposal, tag_actions: editedActions };
      await updateClusteringProposal(id, updated);
      const result = await applyClusteringProposal(id);
      if (result.status === 'applied') {
        navigate('/graph');
      } else {
        alert('应用失败: ' + JSON.stringify(result.errors || result.error));
      }
    } catch (e: any) {
      alert('应用失败: ' + (e?.message || '未知错误'));
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!proposal) return <div style={{ padding: 24 }}>未找到聚类提案</div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 8px 0' }}>主题聚类提案</h2>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{proposal.article_title}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{proposal.article_summary}</div>
      </div>

      {/* Tag Actions */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 12px 0' }}>
          标签聚类 ({editedActions.length})
        </h3>
        {editedActions.map((action, idx) => (
          <div
            key={idx}
            style={{
              padding: 14,
              marginBottom: 8,
              background: action.action === 'MERGE' ? '#f0f9ff' : '#fefce8',
              borderRadius: 8,
              borderLeft: action.action === 'MERGE' ? '3px solid #3b82f6' : '3px solid #f59e0b',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{action.tag_name}</span>
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: action.action === 'MERGE' ? '#dbeafe' : '#fef3c7',
                  color: action.action === 'MERGE' ? '#1d4ed8' : '#92400e',
                }}>
                  {action.action === 'MERGE' ? '合并到已有' : '新建主题'}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  置信度 {(action.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <button
                onClick={() => removeAction(idx)}
                style={{ padding: '2px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12 }}
              >
                删除
              </button>
            </div>

            {action.reason && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{action.reason}</div>
            )}

            {/* Matched candidates for MERGE actions */}
            {action.action === 'MERGE' && action.matched_candidates?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>匹配到的已有主题:</div>
                {action.matched_candidates.map((c, ci) => (
                  <div key={ci} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 4, fontSize: 12,
                  }}>
                    <span>{c.name}</span>
                    <span style={{ color: '#94a3b8' }}>相似度 {(c.similarity * 100).toFixed(0)}%</span>
                  </div>
                ))}
                <button
                  onClick={() => toggleAction(idx)}
                  style={{ marginTop: 4, padding: '2px 8px', border: '1px solid #f59e0b', background: '#fff', borderRadius: 4, color: '#f59e0b', cursor: 'pointer', fontSize: 11 }}
                >
                  改为新建主题
                </button>
              </div>
            )}

            {/* Editable fields for NEW actions */}
            {action.action === 'NEW' && (
              <div style={{ marginTop: 6 }}>
                <input
                  value={action.proposed_description || ''}
                  onChange={e => updateActionField(idx, 'proposed_description', e.target.value)}
                  placeholder="输入新主题描述..."
                  style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}
                />
                {action.action === 'NEW' && action.matched_candidates?.length > 0 && (
                  <button
                    onClick={() => toggleAction(idx)}
                    style={{ marginTop: 4, padding: '2px 8px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 11 }}
                  >
                    改为合并到已有
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Topic Edges */}
      {proposal.topic_edges?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px 0' }}>
            主题间关系 ({proposal.topic_edges.length})
          </h3>
          {proposal.topic_edges.map((edge, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: 8, marginBottom: 4,
                background: '#f8fafc', borderRadius: 6, fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 500 }}>{edge.source_tag}</span>
              <span style={{ color: '#3b82f6' }}>[{edge.relation_type}]</span>
              <span style={{ fontWeight: 500 }}>{edge.target_tag}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>{edge.reason}</span>
              <button
                onClick={() => removeTopicEdge(idx)}
                style={{ padding: '2px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 11 }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Apply button */}
      <button
        onClick={handleApply}
        disabled={applying}
        style={{
          width: '100%', padding: '12px',
          background: applying ? '#94a3b8' : '#3b82f6',
          color: '#fff', border: 'none', borderRadius: 8,
          cursor: applying ? 'not-allowed' : 'pointer',
          fontSize: 15, fontWeight: 600,
        }}
      >
        {applying ? '正在写入全局图谱...' : '确认并写入全局图谱'}
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/ClusteringProposalPage.tsx
git commit -m "feat: add clustering proposal page with tag review UI"
```

---

### Task 11: Frontend — Rebuild GlobalGraphPage

**Files:**
- Modify: `frontend/src/pages/GlobalGraphPage.tsx`

**Step 1: Replace entire file content**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import GraphEditor from '../components/GraphEditor';
import { getGlobalGraph, getLocalGraph, getNodeDetail, getDraftGraph } from '../api/client';
import type { GraphNode, GraphEdge } from '../types/graph';
import { NODE_COLORS } from '../types/graph';

type FilterType = 'all' | 'topic' | 'article';

export default function GlobalGraphPage() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [articleGraph, setArticleGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const loadGlobalGraph = useCallback(async (ft: FilterType) => {
    setLoading(true);
    try {
      const result = await getGlobalGraph(ft);
      const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
        id: n.id,
        nodeType: n.node_type,
        name: n.name,
        description: n.description,
      }));
      const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relationType: e.relation_type,
        confidence: e.confidence,
      }));
      setGraphData({ nodes, edges });
    } catch (e) {
      console.error('Failed to load global graph', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGlobalGraph(filterType);
  }, [filterType, loadGlobalGraph]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setSelectedNode(node);
    setArticleGraph(null);

    if (node.nodeType === 'article') {
      // Load article's internal draft graph
      try {
        const detail = await getNodeDetail(nodeId);
        if (detail.source_document_id) {
          // Try to load the draft graph for this article
          const dgRes = await fetch(`/api/documents/${detail.source_document_id}/draft-graph`).then(r => r.json());
          if (dgRes?.graph_json) {
            const gj = dgRes.graph_json;
            const nodes: GraphNode[] = (gj.nodes || []).map((n: any) => ({
              id: n.temp_id || n.id,
              nodeType: n.node_type,
              name: n.name,
              description: n.description,
            }));
            const edges: GraphEdge[] = (gj.edges || []).map((e: any) => ({
              id: e.temp_id || e.id,
              source: e.source,
              target: e.target,
              relationType: e.relation_type,
              confidence: e.confidence,
            }));
            setArticleGraph({ nodes, edges });
          }
        }
      } catch {
        // ignore - article internal graph not available
      }
    } else {
      // Expand topic node neighbors
      try {
        const result = await getLocalGraph(nodeId, 1);
        const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
          id: n.id,
          nodeType: n.node_type,
          name: n.name,
          description: n.description,
        }));
        const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relationType: e.relation_type,
          confidence: e.confidence,
        }));
        setGraphData({ nodes, edges });
      } catch {
        // ignore
      }
    }
  }, [graphData.nodes]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      // First try to find by node ID directly
      const result = await getLocalGraph(searchQuery, 2);
      if (result.nodes?.length > 0) {
        const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
          id: n.id, nodeType: n.node_type, name: n.name, description: n.description,
        }));
        const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target, relationType: e.relation_type, confidence: e.confidence,
        }));
        setGraphData({ nodes, edges });
      } else {
        // Fallback: search by name in global graph
        await loadGlobalGraph(filterType);
      }
    } catch {
      alert('未找到节点');
    } finally {
      setLoading(false);
    }
  };

  // Count nodes by type
  const topicCount = graphData.nodes.filter(n => n.nodeType === 'topic').length;
  const articleCount = graphData.nodes.filter(n => n.nodeType === 'article').length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      {/* Main graph area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Top bar: search + filter */}
        <div style={{ padding: 12, borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索节点..."
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {loading ? '搜索中...' : '搜索'}
          </button>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {(['all', 'topic', 'article'] as FilterType[]).map(ft => (
              <button
                key={ft}
                onClick={() => setFilterType(ft)}
                style={{
                  padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  background: filterType === ft ? '#3b82f6' : '#f1f5f9',
                  color: filterType === ft ? '#fff' : '#64748b',
                  border: 'none',
                }}
              >
                {ft === 'all' ? `全部 (${topicCount + articleCount})` : ft === 'topic' ? `主题 (${topicCount})` : `文章 (${articleCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Graph */}
        <div style={{ flex: 1 }}>
          <GraphEditor
            graphData={graphData}
            editable={false}
            onNodeClick={handleNodeClick}
          />
        </div>
      </div>

      {/* Right panel: detail */}
      <div style={{ width: 360, borderLeft: '1px solid #e2e8f0', overflowY: 'auto' }}>
        {selectedNode ? (
          <div style={{ padding: 16 }}>
            {/* Node header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              borderLeft: `4px solid ${NODE_COLORS[selectedNode.nodeType] || '#94a3b8'}`, paddingLeft: 10,
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{selectedNode.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedNode.nodeType}</div>
              </div>
            </div>

            {selectedNode.description && (
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 1.5 }}>
                {selectedNode.description}
              </div>
            )}

            {/* Article internal graph */}
            {articleGraph && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ fontSize: 13, margin: '0 0 8px 0', color: '#64748b' }}>文章内部图谱</h4>
                <div style={{ height: 300, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                  <GraphEditor graphData={articleGraph} editable={false} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>
            点击节点查看详情
            <br /><br />
            点击<b>主题</b>节点展开邻居
            <br />
            点击<b>文章</b>节点查看内部图谱
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/GlobalGraphPage.tsx
git commit -m "feat: rebuild global graph page with cluster view and article drawer"
```

---

### Task 12: Frontend — Update App Routes and DraftGraphPage

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/DraftGraphPage.tsx`

**Step 1: Add ClusteringProposalPage route to App.tsx**

Add import:
```typescript
import ClusteringProposalPage from './pages/ClusteringProposalPage';
```

Add route after the `/proposal/:id` route:
```tsx
<Route path="/clustering/:id" element={<ClusteringProposalPage />} />
```

**Step 2: Update DraftGraphPage confirm navigation**

In `DraftGraphPage.tsx`, find the `handleConfirm` function. After `const result = await confirmDraftGraph(id);`, change:

From:
```typescript
if (result.proposal_id) {
  navigate(`/proposal/${result.proposal_id}`);
}
```

To:
```typescript
if (result.proposal_id) {
  navigate(`/clustering/${result.proposal_id}`);
}
```

**Step 3: Verify frontend compiles**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/DraftGraphPage.tsx
git commit -m "feat: wire clustering proposal page into app flow"
```

---

### Task 13: Integration — End-to-End Test

**Step 1: Start the backend**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/backend && uvicorn app.main:app --reload --port 8000`

**Step 2: Start the frontend**

Run: `cd /Users/yaoduanyang/Desktop/cangjie/personal-kb-v1/frontend && npm run dev`

**Step 3: Test the complete flow**

1. Open `http://localhost:5173/import`
2. Import an article (title + content)
3. Go through the 3-stage extraction wizard
4. On DraftGraphPage, click "确认图谱"
5. Should navigate to ClusteringProposalPage (`/clustering/:id`)
6. Review tags: confirm merges, edit new topic descriptions
7. Click "确认并写入全局图谱"
8. Should navigate to GlobalGraphPage (`/graph`)
9. Verify: topic and article nodes appear in the global graph
10. Click a topic node to expand neighbors
11. Click an article node to see internal graph

**Step 4: Verify API directly**

```bash
# Check global graph has nodes
curl http://localhost:8000/api/graph/global | python -m json.tool

# Filter by topic only
curl "http://localhost:8000/api/graph/global?filter_type=topic" | python -m json.tool
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete global knowledge network with tag clustering"
```
