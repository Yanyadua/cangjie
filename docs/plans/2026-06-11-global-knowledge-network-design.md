# Global Knowledge Network Design

## Overview

Transform isolated per-article graphs into an interconnected global knowledge network where articles are nodes connected through auto-discovered topic clusters.

## Core Model

### Dual-Layer Graph

The global graph has exactly two node types and three edge types:

**Nodes:**
- `topic`: Auto-discovered topic clusters (e.g., "Agent Evaluation", "LLM Training")
- `article`: One per imported article

**Edges:**
- `article --tag--> topic`: Article belongs to a topic
- `topic --related_to--> topic`: Inter-topic relationships
- `topic --contains--> topic`: Hierarchical containment (e.g., "AI" contains "Agents")

### Data Model

**Topic Node:**
```
Node {
  node_type: "topic"
  name: "Agent Evaluation"
  description: "Research on AI agent evaluation methods, benchmarks, tools..."
  embedding: [...]              // for semantic retrieval
  metadata: {
    article_count: 5,
    auto_created: true,
    source_article_id: "xxx"    // first article that created this topic
  }
}
```

**Article Node:**
```
Node {
  node_type: "article"
  name: "Agent Evaluation: From Benchmarks to Practice"
  description: "Article summary..."
  source_document_id: "xxx"
  embedding: [...]              // generated from summary + tags
}
```

## Flow: Tag Generation & Clustering

### Step 1: Tag Generation
- Input: Article summary + core concepts (from extraction stage 1)
- LLM generates 3-5 topic tags with name, confidence, reason
- Output: `[{name, confidence, reason}, ...]`

### Step 2: Semantic Matching
- For each tag, compute embedding and search top-3 similar topic nodes (cosine >= 0.8)
- Reuse: `vector_store.py` for similarity search, `entity_resolution.py` for name matching

### Step 3: Clustering Proposal
- For each tag, AI decides: MERGE (similarity >= 0.85), NEW (no good match), or SKIP (low confidence)
- Also detects inter-topic relationships
- Output: `ClusteringProposal` with tag_actions, topic_edges, article_tags

### Step 4: User Confirmation (Frontend)
- Show each tag with matches: user can confirm merge / reject / manually select
- New topics: user can edit name and description
- Topic relationships: user can confirm / delete

### Step 5: Execute Write
1. Create new topic nodes (with embedding)
2. For merged tags: update existing topic description
3. Create article --tag--> topic edges
4. Create topic --related_to--> topic edges
5. Update topic article_count

## Integration with Existing Flow

```
Current (unchanged):
  Import -> ExtractionWizard(4 stages) -> DraftGraphPage(edit) -> confirm

New (after confirm):
  confirm -> Tag Generation -> Clustering Proposal -> User Confirm -> Write to Global Graph
                                                                          |
                                                            Auto-navigate to proposal page
```

## Frontend Design

### Global Graph Page (rebuilt)
- Three-layer view: cluster visualization + detail panel + article internal view
- Click topic node: show associated articles and related topics
- Click article node: slide-out drawer showing internal graph (reuse GraphEditor)
- Filter bar: All / Topics / Articles

### Clustering Proposal Page (new, replaces InsertionProposalPage)
- Show article summary and extracted tags
- Per-tag: match results with confirm/reject/edit actions
- New topics: editable name and description fields
- Topic relationships: confirm/delete toggles
- "Confirm and Write to Global Graph" button

## Edge Cases

1. **Empty global graph** (first article): Create all topic nodes + article node, no merge needed
2. **Ambiguous tags** (similarity 0.7-0.85): Force user decision, never auto-merge
3. **One tag matches multiple topics**: Show top-3 candidates, user selects
4. **Homonyms** (e.g., "Apple" fruit vs company): Embedding dissimilarity auto-creates new topic
5. **Article deletion**: Soft-delete article node + detach tag edges + update topic article_count
6. **Orphan topics** (0 articles after deletion): Keep topic structure, mark as orphan

## Code Reuse Plan

| Component | Action |
|---|---|
| `graph_extractor.py` | No change - still used for per-article extraction |
| `entity_resolution.py` | Adapt: use for topic name matching |
| `insertion_planner.py` | Rewrite: from "merge all entities" to "tag clustering proposal" |
| `graph_patch.py` | Adapt: patch operations for tag clustering logic |
| `patch_validator.py` | Adapt: add topic/article node type validation |
| `vector_store.py` | No change |
| `graph_store.py` | Minor: add topic-specific queries (by article_count, etc.) |
| `InsertionProposalPage.tsx` | Rewrite as ClusteringProposalPage |
| `GlobalGraphPage.tsx` | Rebuild with cluster view + article drawer |
