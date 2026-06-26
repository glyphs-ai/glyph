/**
 * Package-private input parsing + validation helpers for the
 * `glyph workflow ...` mutation primitives (consumed by `./mutate.ts`):
 * node-kind / finish-outcome guards, the `--parent-node-ids` csv
 * parser, and the `--spec-file` subgraph-body validator.
 */

import type {
  AddSubgraphRequest,
  AddSubgraphRequestEdge,
  AddSubgraphRequestNode,
  WorkflowNodeKind,
  WorkflowNodeRef,
} from "@glyphs-ai/sdk";

export const KNOWN_NODE_KINDS: readonly WorkflowNodeKind[] = ["coordinator", "worker", "human"];
export const KNOWN_FINISH_OUTCOMES: readonly ("succeeded" | "failed")[] = ["succeeded", "failed"];

export function isNodeKind(s: string): s is WorkflowNodeKind {
  return (KNOWN_NODE_KINDS as readonly string[]).includes(s);
}

export function isFinishOutcome(s: string): s is "succeeded" | "failed" {
  return (KNOWN_FINISH_OUTCOMES as readonly string[]).includes(s);
}

/**
 * Parse `--parent-node-ids <id1,id2,...>`. Empty / unset returns `[]`;
 * the substrate rejects an empty list with `EmptyParentsError` -> 400 for
 * every non-bootstrap insertion. The CLI does NOT pre-reject -- the
 * server's rejection carries the canonical error name + status.
 *
 * Whitespace inside an id is preserved (substrate's
 * `InvalidWorkflowNodeIdError` will catch malformed ids); only the
 * outer comma-split is trimmed.
 */
export function parseParents(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === "") return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export function validateAddSubgraphRequest(
  raw: unknown,
): { ok: true; body: AddSubgraphRequest } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: "--spec-file must be a JSON object with `nodes` and `edges` arrays",
    };
  }
  const nodesRaw = raw.nodes;
  const edgesRaw = raw.edges;
  if (!Array.isArray(nodesRaw) || !Array.isArray(edgesRaw)) {
    return {
      ok: false,
      error: "--spec-file must be a JSON object with `nodes` and `edges` arrays",
    };
  }

  const nodes: AddSubgraphRequestNode[] = [];
  for (let i = 0; i < nodesRaw.length; i += 1) {
    const node = nodesRaw[i];
    if (!isPlainObject(node)) return { ok: false, error: `nodes[${i}] must be an object` };

    const tempId = node.tempId;
    if (typeof tempId !== "string" || tempId.length === 0) {
      return { ok: false, error: `nodes[${i}].tempId must be a non-empty string` };
    }

    const kind = node.kind;
    if (typeof kind !== "string" || !isNodeKind(kind)) {
      return {
        ok: false,
        error: `nodes[${i}].kind must be one of: ${KNOWN_NODE_KINDS.join(", ")}`,
      };
    }

    if (!("spec" in node)) {
      return { ok: false, error: `nodes[${i}].spec is required` };
    }

    const existingParentsRaw = node.existingParents;
    let existingParents: readonly string[] | undefined;
    if (existingParentsRaw !== undefined) {
      if (!Array.isArray(existingParentsRaw)) {
        return { ok: false, error: `nodes[${i}].existingParents must be an array` };
      }
      const parents: string[] = [];
      for (const parent of existingParentsRaw) {
        if (typeof parent !== "string" || parent.length === 0) {
          return {
            ok: false,
            error: `nodes[${i}].existingParents entries must be non-empty strings`,
          };
        }
        parents.push(parent);
      }
      existingParents = parents;
    }

    nodes.push({
      tempId,
      kind,
      spec: node.spec,
      ...(existingParents !== undefined ? { existingParents } : {}),
    });
  }

  const edges: AddSubgraphRequestEdge[] = [];
  for (let i = 0; i < edgesRaw.length; i += 1) {
    const edge = edgesRaw[i];
    if (!isPlainObject(edge)) return { ok: false, error: `edges[${i}] must be an object` };
    const from = validateNodeRefInput(edge.from, `edges[${i}].from`);
    if (!from.ok) return from;
    const to = validateNodeRefInput(edge.to, `edges[${i}].to`);
    if (!to.ok) return to;
    edges.push({ from: from.value, to: to.value });
  }

  return { ok: true, body: { nodes, edges } };
}

function validateNodeRefInput(
  raw: unknown,
  path: string,
): { ok: true; value: WorkflowNodeRef } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `${path} must be an object` };
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    return { ok: false, error: `${path} must have exactly one key: nodeId or tempId` };
  }
  if ("nodeId" in raw) {
    return typeof raw.nodeId === "string" && raw.nodeId.length > 0
      ? { ok: true, value: { nodeId: raw.nodeId } }
      : { ok: false, error: `${path}.nodeId must be a non-empty string` };
  }
  if ("tempId" in raw) {
    return typeof raw.tempId === "string" && raw.tempId.length > 0
      ? { ok: true, value: { tempId: raw.tempId } }
      : { ok: false, error: `${path}.tempId must be a non-empty string` };
  }
  return { ok: false, error: `${path} must have key nodeId or tempId` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
