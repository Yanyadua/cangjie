"""
Entity resolution and alignment for the Personal Knowledge Base.

Compares draft nodes extracted from a new article against existing nodes in the
global graph.  Resolution methods include exact name match, alias match,
canonical-name normalization, and embedding similarity.  The module returns
match *suggestions* -- it never auto-merges, leaving the final decision to the
user.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

logger = logging.getLogger(__name__)

_EMBEDDING_SIMILARITY_THRESHOLD = 0.85


def _normalize(name: str) -> str:
    """Return a canonical, lower-cased, whitespace-stripped form of *name*."""
    # Unicode NFKC normalization (full-width -> half-width, etc.)
    name = unicodedata.normalize("NFKC", name)
    # Lowercase
    name = name.lower()
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()
    return name


class EntityResolver:
    """Find potential matches between draft nodes and existing graph nodes."""

    # ── Public API ──

    async def find_matches(
        self,
        draft_nodes: list[dict],
        existing_nodes: list[dict],
        embedding_client: Any,
    ) -> list[dict]:
        """Return a list of match suggestions for user confirmation.

        Each suggestion is a dict::

            {
                "draft_temp_id": str,
                "existing_node_id": str,
                "confidence": float,
                "method": "exact_name"
                         | "alias_match"
                         | "canonical_name"
                         | "embedding_similarity",
            }

        Parameters
        ----------
        draft_nodes:
            List of draft node dicts, each with at least ``temp_id`` and
            ``name``.
        existing_nodes:
            List of existing node dicts, each with at least ``id``, ``name``,
            and optionally ``canonical_name`` and ``aliases``.
        embedding_client:
            Client with an ``embed(texts: list[str]) -> list[list[float]]``
            method used for similarity comparison.
        """

        suggestions: list[dict] = []
        used_pairs: set[tuple[str, str]] = set()

        # Pre-compute normalized forms for existing nodes
        existing_index = self._build_existing_index(existing_nodes)

        # ── Pass 1: exact name + alias + canonical-name matches ──
        for draft in draft_nodes:
            draft_id = draft["temp_id"]
            draft_name = draft["name"]
            draft_norm = _normalize(draft_name)

            for entry in existing_index:
                existing_id = str(entry["id"])
                pair = (draft_id, existing_id)
                if pair in used_pairs:
                    continue

                # Exact name match
                if draft_norm == entry["name_norm"]:
                    suggestions.append(self._make_suggestion(
                        draft_id, existing_id, 1.0, "exact_name",
                    ))
                    used_pairs.add(pair)
                    continue

                # Alias match
                if draft_norm in entry["alias_norms"]:
                    suggestions.append(self._make_suggestion(
                        draft_id, existing_id, 0.95, "alias_match",
                    ))
                    used_pairs.add(pair)
                    continue

                # Canonical name match
                if entry["canonical_norm"] and draft_norm == entry["canonical_norm"]:
                    suggestions.append(self._make_suggestion(
                        draft_id, existing_id, 0.95, "canonical_name",
                    ))
                    used_pairs.add(pair)

        # ── Pass 2: embedding similarity ──
        # Only consider draft nodes that have not yet been matched.
        unmatched_drafts = [
            d for d in draft_nodes
            if d["temp_id"] not in {s["draft_temp_id"] for s in suggestions}
        ]

        if unmatched_drafts and existing_index:
            try:
                suggestions = await self._embedding_pass(
                    unmatched_drafts,
                    existing_index,
                    embedding_client,
                    suggestions,
                    used_pairs,
                )
            except Exception:
                logger.exception(
                    "Embedding-based entity resolution failed; "
                    "falling back to string-only results",
                )

        logger.info(
            "Entity resolution found %d match suggestion(s) for %d draft node(s)",
            len(suggestions),
            len(draft_nodes),
        )
        return suggestions

    # ── Helpers ──

    def _build_existing_index(self, existing_nodes: list[dict]) -> list[dict]:
        """Build a normalized index for fast string-level comparison."""

        index: list[dict] = []
        for node in existing_nodes:
            aliases = node.get("aliases") or []
            index.append({
                "id": node["id"],
                "name_norm": _normalize(node["name"]),
                "canonical_norm": (
                    _normalize(node["canonical_name"])
                    if node.get("canonical_name")
                    else None
                ),
                "alias_norms": {_normalize(a) for a in aliases},
                # Keep the raw name for embedding lookup
                "name": node["name"],
            })
        return index

    async def _embedding_pass(
        self,
        unmatched_drafts: list[dict],
        existing_index: list[dict],
        embedding_client: Any,
        suggestions: list[dict],
        used_pairs: set[tuple[str, str]],
    ) -> list[dict]:
        """Compute embedding similarity between unmatched drafts and existing nodes."""

        import numpy as np  # local import to avoid hard dependency at import time

        # Gather texts for embedding
        draft_texts = [d["name"] for d in unmatched_drafts]
        existing_texts = [e["name"] for e in existing_index]

        # Use embed_batch for batched embedding; fall back to single embed.
        if hasattr(embedding_client, "embed_batch"):
            draft_embeddings = await embedding_client.embed_batch(draft_texts)
            existing_embeddings = await embedding_client.embed_batch(existing_texts)
        else:
            draft_embeddings = [await embedding_client.embed(t) for t in draft_texts]
            existing_embeddings = [await embedding_client.embed(t) for t in existing_texts]

        draft_arr = np.array(draft_embeddings)
        existing_arr = np.array(existing_embeddings)

        # Cosine similarity matrix (drafts x existing)
        draft_norms = np.linalg.norm(draft_arr, axis=1, keepdims=True)
        existing_norms = np.linalg.norm(existing_arr, axis=1, keepdims=True)

        # Guard against zero-norm vectors
        draft_norms = np.where(draft_norms == 0, 1, draft_norms)
        existing_norms = np.where(existing_norms == 0, 1, existing_norms)

        normed_draft = draft_arr / draft_norms
        normed_existing = existing_arr / existing_norms

        similarity_matrix = normed_draft @ normed_existing.T  # (D, E)

        for di, draft in enumerate(unmatched_drafts):
            draft_id = draft["temp_id"]
            for ei, entry in enumerate(existing_index):
                existing_id = str(entry["id"])
                pair = (draft_id, existing_id)
                if pair in used_pairs:
                    continue

                sim = float(similarity_matrix[di, ei])
                if sim >= _EMBEDDING_SIMILARITY_THRESHOLD:
                    suggestions.append(self._make_suggestion(
                        draft_id, existing_id, round(sim, 4),
                        "embedding_similarity",
                    ))
                    used_pairs.add(pair)

        return suggestions

    @staticmethod
    def _make_suggestion(
        draft_temp_id: str,
        existing_node_id: str,
        confidence: float,
        method: str,
    ) -> dict:
        return {
            "draft_temp_id": draft_temp_id,
            "existing_node_id": existing_node_id,
            "confidence": confidence,
            "method": method,
        }
