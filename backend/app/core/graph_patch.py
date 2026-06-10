"""
Graph patch generation and application for the Personal Knowledge Base.

A *patch* is an ordered list of atomic operations that modify the global graph
to integrate a new article's draft graph.  Operations include creating nodes,
merging nodes, adding aliases, updating descriptions, creating edges, marking
conflicts, and skipping items.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Allowed operation types ──

OP_CREATE_NODE = "CREATE_NODE"
OP_MERGE_NODE = "MERGE_NODE"
OP_ADD_ALIAS = "ADD_ALIAS"
OP_UPDATE_NODE_DESCRIPTION = "UPDATE_NODE_DESCRIPTION"
OP_CREATE_EDGE = "CREATE_EDGE"
OP_UPDATE_EDGE = "UPDATE_EDGE"
OP_MARK_CONFLICT = "MARK_CONFLICT"
OP_SKIP = "SKIP"

ALLOWED_OPS = frozenset({
    OP_CREATE_NODE,
    OP_MERGE_NODE,
    OP_ADD_ALIAS,
    OP_UPDATE_NODE_DESCRIPTION,
    OP_CREATE_EDGE,
    OP_UPDATE_EDGE,
    OP_MARK_CONFLICT,
    OP_SKIP,
})


def _resolve_temp_id(temp_id: str, id_map: dict[str, str]) -> str:
    """Resolve a draft temp_id to a real node id using *id_map*.

    If *temp_id* is already a real id (not in the map), return it as-is.
    """
    return id_map.get(temp_id, temp_id)


class GraphPatcher:
    """Generate and apply graph patches against the global graph store."""

    # ── Patch generation ──

    def generate_patch(self, proposal: dict, confirmed_graph: dict) -> dict:
        """Generate a patch from an insertion proposal and a confirmed draft graph.

        Parameters
        ----------
        proposal:
            Insertion proposal dict with keys ``candidate_positions``,
            ``suggested_merges``, ``suggested_edges``, ``possible_conflicts``.
        confirmed_graph:
            The user-confirmed draft graph dict with ``summary``, ``nodes``,
            ``edges``.

        Returns
        -------
        dict
            A patch dict with key ``operations`` containing a list of operation
            dicts.
        """

        operations: list[dict[str, Any]] = []

        # Build a lookup from temp_id to confirmed node
        draft_nodes_by_temp: dict[str, dict] = {
            n["temp_id"]: n for n in confirmed_graph.get("nodes", [])
        }

        # Track which draft nodes are merged (so we skip creating them)
        merged_temp_ids: set[str] = set()
        # Map from draft temp_id -> existing node id (for edge resolution)
        id_map: dict[str, str] = {}

        # ── 1. MERGE_NODE operations ──
        for merge in proposal.get("suggested_merges") or []:
            draft_temp_id = merge.get("draft_node_temp_id", "")
            existing_id = merge.get("existing_node_id", "")
            if not draft_temp_id or not existing_id:
                logger.warning("Skipping incomplete merge suggestion: %s", merge)
                continue

            operations.append({
                "op": OP_MERGE_NODE,
                "draft_node_temp_id": draft_temp_id,
                "existing_node_id": existing_id,
                "reason": merge.get("reason", ""),
            })
            merged_temp_ids.add(draft_temp_id)
            id_map[draft_temp_id] = existing_id

        # ── 2. CREATE_NODE for un-merged draft nodes ──
        for node in confirmed_graph.get("nodes") or []:
            temp_id = node["temp_id"]
            if temp_id in merged_temp_ids:
                continue

            operations.append({
                "op": OP_CREATE_NODE,
                "node": {
                    "temp_id": temp_id,
                    "node_type": node["node_type"],
                    "name": node["name"],
                    "description": node.get("description", ""),
                },
            })

        # ── 3. ADD_ALIAS for merged nodes ──
        for merge in proposal.get("suggested_merges") or []:
            draft_temp_id = merge.get("draft_node_temp_id", "")
            if draft_temp_id in draft_nodes_by_temp:
                draft_node = draft_nodes_by_temp[draft_temp_id]
                existing_id = merge.get("existing_node_id", "")
                operations.append({
                    "op": OP_ADD_ALIAS,
                    "existing_node_id": existing_id,
                    "alias": draft_node["name"],
                    "reason": f"Alias from merged draft node '{draft_node['name']}'",
                })

        # ── 4. UPDATE_NODE_DESCRIPTION for merged nodes ──
        for merge in proposal.get("suggested_merges") or []:
            draft_temp_id = merge.get("draft_node_temp_id", "")
            if draft_temp_id in draft_nodes_by_temp:
                draft_node = draft_nodes_by_temp[draft_temp_id]
                desc = draft_node.get("description", "")
                if desc:
                    existing_id = merge.get("existing_node_id", "")
                    operations.append({
                        "op": OP_UPDATE_NODE_DESCRIPTION,
                        "existing_node_id": existing_id,
                        "description": desc,
                        "reason": f"Enriched from draft node '{draft_node['name']}'",
                    })

        # ── 5. CREATE_EDGE from confirmed draft edges ──
        for edge in confirmed_graph.get("edges") or []:
            source_temp = edge["source"]
            target_temp = edge["target"]

            # Both source and target must resolve (via merge map or creation)
            source_resolved = id_map.get(source_temp, source_temp)
            target_resolved = id_map.get(target_temp, target_temp)

            operations.append({
                "op": OP_CREATE_EDGE,
                "source": source_resolved,
                "target": target_resolved,
                "relation_type": edge["relation_type"],
                "confidence": edge.get("confidence", 1.0),
                "evidence_text": edge.get("evidence", ""),
            })

        # ── 6. Additional suggested edges from proposal ──
        for sedge in proposal.get("suggested_edges") or []:
            operations.append({
                "op": OP_CREATE_EDGE,
                "source": sedge.get("source", ""),
                "target": sedge.get("target", ""),
                "relation_type": sedge.get("relation_type", "related_to"),
                "confidence": sedge.get("confidence", 0.5),
                "evidence_text": sedge.get("reason", ""),
            })

        # ── 7. MARK_CONFLICT ──
        for conflict in proposal.get("possible_conflicts") or []:
            operations.append({
                "op": OP_MARK_CONFLICT,
                "involved_nodes": conflict.get("involved_nodes", []),
                "description": conflict.get("description", ""),
                "resolution_hint": conflict.get("resolution_hint", ""),
            })

        logger.info(
            "Generated patch with %d operation(s)",
            len(operations),
        )
        return {"operations": operations}

    # ── Patch application ──

    async def apply_patch(self, patch: dict, graph_store: Any) -> dict:
        """Apply a patch to the global graph store sequentially.

        Each operation is treated as atomic: success or failure is logged per
        operation without rolling back previous operations.

        Parameters
        ----------
        patch:
            Patch dict with key ``operations`` containing a list of operation
            dicts.
        graph_store:
            Store with methods:
            - ``create_node(node_dict) -> str``  (returns new node id)
            - ``merge_node(draft_temp_id, existing_node_id)``
            - ``add_alias(node_id, alias)``
            - ``update_node_description(node_id, description)``
            - ``create_edge(source, target, relation_type, confidence, evidence_text) -> str``
            - ``mark_conflict(description, involved_nodes, resolution_hint)``
            - ``get_edge(source, target, relation_type) -> dict | None``

        Returns
        -------
        dict
            Result with keys ``applied`` (count), ``failed`` (count), and
            ``details`` (list of per-operation outcomes).
        """

        operations = patch.get("operations") or []
        applied = 0
        failed = 0
        details: list[dict[str, Any]] = []

        # Track temp_id -> real_id mapping for CREATE_NODE results
        id_map: dict[str, str] = {}

        for idx, op in enumerate(operations):
            op_type = op.get("op", "")
            try:
                result = await self._apply_single_op(
                    op_type, op, graph_store, id_map,
                )
                if result:
                    applied += 1
                    details.append({
                        "index": idx,
                        "op": op_type,
                        "status": "success",
                        "result": result,
                    })
                else:
                    # SKIP operations
                    applied += 1
                    details.append({
                        "index": idx,
                        "op": op_type,
                        "status": "skipped",
                    })
            except Exception as exc:
                failed += 1
                logger.error(
                    "Patch operation %d (%s) failed: %s",
                    idx,
                    op_type,
                    exc,
                )
                details.append({
                    "index": idx,
                    "op": op_type,
                    "status": "failed",
                    "error": str(exc),
                })

        logger.info(
            "Patch applied: %d succeeded, %d failed out of %d operation(s)",
            applied,
            failed,
            len(operations),
        )
        return {
            "applied": applied,
            "failed": failed,
            "total": len(operations),
            "details": details,
        }

    # ── Single operation handlers ──

    async def _apply_single_op(
        self,
        op_type: str,
        op: dict,
        graph_store: Any,
        id_map: dict[str, str],
    ) -> Any:
        """Apply a single patch operation.  Returns a result or None for SKIP."""

        if op_type == OP_CREATE_NODE:
            node_data = op["node"]
            temp_id = node_data["temp_id"]
            new_id = await graph_store.create_node({
                "node_type": node_data["node_type"],
                "name": node_data["name"],
                "description": node_data.get("description", ""),
            })
            id_map[temp_id] = str(new_id)
            logger.debug("Created node %s -> %s", temp_id, new_id)
            return {"node_id": str(new_id)}

        if op_type == OP_MERGE_NODE:
            draft_temp_id = op["draft_node_temp_id"]
            existing_id = op["existing_node_id"]
            await graph_store.merge_node(draft_temp_id, existing_id)
            id_map[draft_temp_id] = existing_id
            logger.debug("Merged %s into %s", draft_temp_id, existing_id)
            return {"merged_into": existing_id}

        if op_type == OP_ADD_ALIAS:
            node_id = op["existing_node_id"]
            alias = op["alias"]
            await graph_store.add_alias(node_id, alias)
            logger.debug("Added alias '%s' to node %s", alias, node_id)
            return {"alias": alias}

        if op_type == OP_UPDATE_NODE_DESCRIPTION:
            node_id = op["existing_node_id"]
            description = op["description"]
            await graph_store.update_node_description(node_id, description)
            logger.debug("Updated description for node %s", node_id)
            return {"node_id": node_id}

        if op_type == OP_CREATE_EDGE:
            source = _resolve_temp_id(op["source"], id_map)
            target = _resolve_temp_id(op["target"], id_map)
            relation_type = op["relation_type"]
            confidence = op.get("confidence", 1.0)
            evidence_text = op.get("evidence_text", "")

            # Check for duplicate
            existing = await graph_store.get_edge(source, target, relation_type)
            if existing:
                logger.debug(
                    "Edge %s -[%s]-> %s already exists, skipping",
                    source,
                    relation_type,
                    target,
                )
                return {"edge_id": existing.get("id"), "status": "already_exists"}

            edge_id = await graph_store.create_edge(
                source=source,
                target=target,
                relation_type=relation_type,
                confidence=confidence,
                evidence_text=evidence_text,
            )
            logger.debug("Created edge %s -[%s]-> %s", source, relation_type, target)
            return {"edge_id": str(edge_id)}

        if op_type == OP_UPDATE_EDGE:
            source = _resolve_temp_id(op["source"], id_map)
            target = _resolve_temp_id(op["target"], id_map)
            relation_type = op["relation_type"]
            await graph_store.update_edge(
                source=source,
                target=target,
                relation_type=relation_type,
                **{k: v for k, v in op.items() if k not in {"op", "source", "target", "relation_type"}},
            )
            return {"source": source, "target": target}

        if op_type == OP_MARK_CONFLICT:
            await graph_store.mark_conflict(
                description=op.get("description", ""),
                involved_nodes=op.get("involved_nodes", []),
                resolution_hint=op.get("resolution_hint", ""),
            )
            logger.debug("Marked conflict: %s", op.get("description", ""))
            return {"conflict_marked": True}

        if op_type == OP_SKIP:
            return None

        raise ValueError(f"Unknown operation type: {op_type}")
