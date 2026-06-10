"""
Patch validator for the Personal Knowledge Base.

Validates a graph patch before it is applied to the global graph, checking
operation types, node/edge type whitelists, referential integrity,
self-loops, duplicate edges, confidence bounds, and evidence requirements.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Whitelists ──

ALLOWED_OPS = frozenset({
    "CREATE_NODE",
    "MERGE_NODE",
    "ADD_ALIAS",
    "UPDATE_NODE_DESCRIPTION",
    "CREATE_EDGE",
    "UPDATE_EDGE",
    "MARK_CONFLICT",
    "SKIP",
})

VALID_NODE_TYPES = frozenset({
    "article", "concept", "claim", "topic", "person", "organization",
    "paper", "project", "framework", "tool", "method", "technology",
    "question", "chunk",
})

VALID_RELATION_TYPES = frozenset({
    "related_to", "contains", "part_of", "supports", "contradicts",
    "depends_on", "implements", "improves", "causes", "compares_with",
    "derived_from", "used_for", "evidence_for", "mentions", "similar_to",
    "belongs_to",
})


class PatchValidator:
    """Validate a graph patch before application."""

    def validate(
        self,
        patch: dict,
        existing_nodes: set[str],
        existing_edges: set[tuple[str, str, str]],
    ) -> tuple[bool, list[str]]:
        """Validate a patch against the current graph state.

        Parameters
        ----------
        patch:
            Patch dict with key ``operations`` containing a list of operation
            dicts.
        existing_nodes:
            Set of node IDs that currently exist in the graph.
        existing_edges:
            Set of ``(source, target, relation_type)`` tuples for existing
            edges.

        Returns
        -------
        tuple[bool, list[str]]
            ``(is_valid, errors)`` where *is_valid* is ``True`` if no errors
            were found and *errors* is a list of human-readable error strings.
        """

        errors: list[str] = []
        operations = patch.get("operations") or []

        # Track nodes and edges that will be created by this patch
        # so that later operations can reference them.
        pending_nodes: set[str] = set()
        pending_edges: set[tuple[str, str, str]] = set()

        for idx, op in enumerate(operations):
            op_errors = self._validate_operation(
                idx,
                op,
                existing_nodes,
                existing_edges,
                pending_nodes,
                pending_edges,
            )
            errors.extend(op_errors)

        is_valid = len(errors) == 0

        if errors:
            logger.warning(
                "Patch validation found %d error(s): %s",
                len(errors),
                "; ".join(errors),
            )
        else:
            logger.debug("Patch validation passed (%d operation(s))", len(operations))

        return is_valid, errors

    # ── Per-operation validation ──

    def _validate_operation(
        self,
        idx: int,
        op: dict[str, Any],
        existing_nodes: set[str],
        existing_edges: set[tuple[str, str, str]],
        pending_nodes: set[str],
        pending_edges: set[tuple[str, str, str]],
    ) -> list[str]:
        """Validate a single operation and return a list of error strings."""

        errors: list[str] = []
        prefix = f"operations[{idx}]"

        op_type = op.get("op")
        if not op_type:
            errors.append(f"{prefix}: missing 'op' field")
            return errors

        if op_type not in ALLOWED_OPS:
            errors.append(f"{prefix}: unknown op type '{op_type}'")
            return errors

        # Dispatch to type-specific validation
        if op_type == "CREATE_NODE":
            errors.extend(self._validate_create_node(idx, op, pending_nodes))
        elif op_type == "MERGE_NODE":
            errors.extend(self._validate_merge_node(idx, op, existing_nodes, pending_nodes))
        elif op_type == "ADD_ALIAS":
            errors.extend(self._validate_add_alias(idx, op, existing_nodes, pending_nodes))
        elif op_type == "UPDATE_NODE_DESCRIPTION":
            errors.extend(self._validate_update_description(idx, op, existing_nodes, pending_nodes))
        elif op_type == "CREATE_EDGE":
            errors.extend(self._validate_create_edge(
                idx, op, existing_nodes, existing_edges, pending_nodes, pending_edges,
            ))
        elif op_type == "UPDATE_EDGE":
            errors.extend(self._validate_update_edge(
                idx, op, existing_nodes, existing_edges, pending_nodes, pending_edges,
            ))
        elif op_type == "MARK_CONFLICT":
            errors.extend(self._validate_mark_conflict(idx, op))
        elif op_type == "SKIP":
            pass  # No validation needed

        return errors

    # ── Type-specific validators ──

    def _validate_create_node(
        self,
        idx: int,
        op: dict,
        pending_nodes: set[str],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        node = op.get("node")
        if not node or not isinstance(node, dict):
            errors.append(f"{prefix}: CREATE_NODE missing 'node' dict")
            return errors

        # node_type whitelist
        node_type = node.get("node_type")
        if not node_type:
            errors.append(f"{prefix}: CREATE_NODE missing node.node_type")
        elif node_type not in VALID_NODE_TYPES:
            errors.append(
                f"{prefix}: invalid node_type '{node_type}', "
                f"allowed: {sorted(VALID_NODE_TYPES)}"
            )

        # name is required
        if not node.get("name"):
            errors.append(f"{prefix}: CREATE_NODE missing node.name")

        # temp_id tracking
        temp_id = node.get("temp_id")
        if temp_id:
            pending_nodes.add(temp_id)

        return errors

    def _validate_merge_node(
        self,
        idx: int,
        op: dict,
        existing_nodes: set[str],
        pending_nodes: set[str],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        existing_id = op.get("existing_node_id")
        if not existing_id:
            errors.append(f"{prefix}: MERGE_NODE missing existing_node_id")
        elif existing_id not in existing_nodes and existing_id not in pending_nodes:
            errors.append(
                f"{prefix}: MERGE_NODE target '{existing_id}' does not exist"
            )

        draft_temp_id = op.get("draft_node_temp_id")
        if draft_temp_id:
            pending_nodes.add(draft_temp_id)

        return errors

    def _validate_add_alias(
        self,
        idx: int,
        op: dict,
        existing_nodes: set[str],
        pending_nodes: set[str],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        node_id = op.get("existing_node_id")
        if not node_id:
            errors.append(f"{prefix}: ADD_ALIAS missing existing_node_id")
        elif node_id not in existing_nodes and node_id not in pending_nodes:
            errors.append(f"{prefix}: ADD_ALIAS node '{node_id}' does not exist")

        alias = op.get("alias")
        if not alias:
            errors.append(f"{prefix}: ADD_ALIAS missing alias")

        return errors

    def _validate_update_description(
        self,
        idx: int,
        op: dict,
        existing_nodes: set[str],
        pending_nodes: set[str],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        node_id = op.get("existing_node_id")
        if not node_id:
            errors.append(f"{prefix}: UPDATE_NODE_DESCRIPTION missing existing_node_id")
        elif node_id not in existing_nodes and node_id not in pending_nodes:
            errors.append(
                f"{prefix}: UPDATE_NODE_DESCRIPTION node '{node_id}' does not exist"
            )

        description = op.get("description")
        if description is None:
            errors.append(f"{prefix}: UPDATE_NODE_DESCRIPTION missing description")

        return errors

    def _validate_create_edge(
        self,
        idx: int,
        op: dict,
        existing_nodes: set[str],
        existing_edges: set[tuple[str, str, str]],
        pending_nodes: set[str],
        pending_edges: set[tuple[str, str, str]],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        source = op.get("source")
        target = op.get("target")
        relation_type = op.get("relation_type")

        if not source:
            errors.append(f"{prefix}: CREATE_EDGE missing source")
        if not target:
            errors.append(f"{prefix}: CREATE_EDGE missing target")

        # Node existence check
        if source and target:
            all_nodes = existing_nodes | pending_nodes
            if source not in all_nodes:
                errors.append(f"{prefix}: CREATE_EDGE source '{source}' does not exist")
            if target not in all_nodes:
                errors.append(f"{prefix}: CREATE_EDGE target '{target}' does not exist")

            # Self-loop check
            if source == target:
                errors.append(f"{prefix}: CREATE_EDGE self-loop on '{source}'")

        # relation_type whitelist
        if not relation_type:
            errors.append(f"{prefix}: CREATE_EDGE missing relation_type")
        elif relation_type not in VALID_RELATION_TYPES:
            errors.append(
                f"{prefix}: invalid relation_type '{relation_type}', "
                f"allowed: {sorted(VALID_RELATION_TYPES)}"
            )

        # Duplicate edge check
        if source and target and relation_type:
            edge_key = (source, target, relation_type)
            if edge_key in existing_edges or edge_key in pending_edges:
                errors.append(
                    f"{prefix}: duplicate edge ({source}, {target}, {relation_type})"
                )
            pending_edges.add(edge_key)

        # Confidence bounds
        confidence = op.get("confidence")
        if confidence is not None:
            try:
                c = float(confidence)
                if c < 0.0 or c > 1.0:
                    errors.append(f"{prefix}: confidence {c} out of range [0, 1]")
            except (TypeError, ValueError):
                errors.append(f"{prefix}: confidence is not a number: {confidence}")

        # Evidence required
        evidence = op.get("evidence_text")
        if evidence is not None and not str(evidence).strip():
            errors.append(f"{prefix}: CREATE_EDGE evidence_text is empty")

        return errors

    def _validate_update_edge(
        self,
        idx: int,
        op: dict,
        existing_nodes: set[str],
        existing_edges: set[tuple[str, str, str]],
        pending_nodes: set[str],
        pending_edges: set[tuple[str, str, str]],
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        source = op.get("source")
        target = op.get("target")
        relation_type = op.get("relation_type")

        if source and target and relation_type:
            edge_key = (source, target, relation_type)
            all_nodes = existing_nodes | pending_nodes
            if source not in all_nodes:
                errors.append(f"{prefix}: UPDATE_EDGE source '{source}' does not exist")
            if target not in all_nodes:
                errors.append(f"{prefix}: UPDATE_EDGE target '{target}' does not exist")

        if relation_type and relation_type not in VALID_RELATION_TYPES:
            errors.append(f"{prefix}: invalid relation_type '{relation_type}'")

        return errors

    def _validate_mark_conflict(
        self,
        idx: int,
        op: dict,
    ) -> list[str]:
        errors: list[str] = []
        prefix = f"operations[{idx}]"

        description = op.get("description")
        if not description:
            errors.append(f"{prefix}: MARK_CONFLICT missing description")

        involved = op.get("involved_nodes")
        if involved is not None and not isinstance(involved, list):
            errors.append(f"{prefix}: MARK_CONFLICT involved_nodes must be a list")

        return errors
