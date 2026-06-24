import type {
  AddEdgeBody,
  AddNodeBody,
  AddSubgraphBody,
  AddSubgraphEdgeInputWire,
  AddSubgraphNodeInputWire,
  CancelWorkflowBody,
  CreateWorkflowBody,
  FinishWorkflowBody,
  NodeRefWire,
  ReplaceNodeSpecBody,
} from "@glyphs-ai/api";
import type { NodeRef, WorkflowNodeKind } from "@glyphs-ai/workflow";
import type { ValidationResult } from "../_shared.js";

const ALLOWED_CREATE_KEYS = new Set(["brief", "details", "coordinatorAgent"]);
const KNOWN_NODE_KINDS: readonly WorkflowNodeKind[] = ["coordinator", "worker", "human"];
const KNOWN_FINISH_KINDS: readonly ("succeeded" | "failed")[] = ["succeeded", "failed"];

export function validateCreatedSinceQuery(
  raw: string | undefined,
): ValidationResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  // Accept any ISO 8601 string that `Date.parse` understands. The
  // substrate forwards the string verbatim into a SQL `>=` predicate
  // against the text-sortable `created_at` column, so any parseable
  // shape works — we only reject obviously malformed input so the
  // caller learns about it at the boundary rather than getting an
  // empty list back.
  if (Number.isNaN(Date.parse(raw))) {
    return { ok: false, error: "createdSince must be an ISO 8601 timestamp" };
  }
  return { ok: true, value: raw };
}

export function validateCreateBody(raw: unknown): ValidationResult<CreateWorkflowBody> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "request body must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_CREATE_KEYS.has(k)) {
      return { ok: false, error: `request body has unknown key "${k}"` };
    }
  }
  const { brief, details, coordinatorAgent } = obj;
  if (typeof brief !== "string" || brief.trim().length === 0) {
    return { ok: false, error: "brief must be a non-empty string" };
  }
  if (typeof coordinatorAgent !== "string" || coordinatorAgent.trim().length === 0) {
    return { ok: false, error: "coordinatorAgent must be a non-empty string" };
  }
  if (details !== undefined && typeof details !== "string") {
    return { ok: false, error: "details, when set, must be a string" };
  }
  return {
    ok: true,
    value: {
      brief,
      coordinatorAgent,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

// ─── Mutation-route body validators ───────────────────────────────
//
// One validator per mutation primitive that takes a body. Each one
// rejects the cheap shape errors at the boundary (unknown keys, wrong
// types, missing required fields) so the substrate sees only inputs
// that are at least *structurally* sane. Domain rules (parent-state,
// cycle, kind enum) are the substrate's job — these validators MUST
// NOT pre-check anything the substrate already validates, or the
// caller would observe two distinct rejection paths for the same
// invariant.

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

export function validateAddNodeBody(raw: unknown): ValidationResult<AddNodeBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  const allowed = new Set(["kind", "spec", "parents"]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
  }
  const { kind, spec, parents } = raw;
  if (typeof kind !== "string" || !(KNOWN_NODE_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      error: `kind must be one of: ${KNOWN_NODE_KINDS.join(", ")}`,
    };
  }
  if (spec === undefined) return { ok: false, error: "spec is required" };
  if (!Array.isArray(parents)) return { ok: false, error: "parents must be an array of strings" };
  for (const p of parents) {
    if (typeof p !== "string" || p.length === 0) {
      return { ok: false, error: "parents entries must be non-empty strings" };
    }
  }
  return {
    ok: true,
    value: {
      kind: kind as AddNodeBody["kind"],
      spec,
      parents: parents as readonly string[],
    },
  };
}

export function validateAddEdgeBody(raw: unknown): ValidationResult<AddEdgeBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  const allowed = new Set(["fromNodeId", "toNodeId"]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
  }
  const { fromNodeId, toNodeId } = raw;
  if (typeof fromNodeId !== "string" || fromNodeId.length === 0) {
    return { ok: false, error: "fromNodeId must be a non-empty string" };
  }
  if (typeof toNodeId !== "string" || toNodeId.length === 0) {
    return { ok: false, error: "toNodeId must be a non-empty string" };
  }
  return { ok: true, value: { fromNodeId, toNodeId } };
}

function validateNodeRefWire(raw: unknown): ValidationResult<NodeRefWire> {
  if (!isPlainObject(raw)) return { ok: false, error: "ref must be an object" };
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    return { ok: false, error: 'ref must have exactly one key: "nodeId" OR "tempId"' };
  }
  if ("nodeId" in raw) {
    if (typeof raw.nodeId !== "string" || raw.nodeId.length === 0) {
      return { ok: false, error: "ref.nodeId must be a non-empty string" };
    }
    return { ok: true, value: { nodeId: raw.nodeId } };
  }
  if ("tempId" in raw) {
    if (typeof raw.tempId !== "string" || raw.tempId.length === 0) {
      return { ok: false, error: "ref.tempId must be a non-empty string" };
    }
    return { ok: true, value: { tempId: raw.tempId } };
  }
  return { ok: false, error: 'ref must have key "nodeId" OR "tempId"' };
}

export function validateAddSubgraphBody(raw: unknown): ValidationResult<AddSubgraphBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  const allowed = new Set(["nodes", "edges"]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
  }
  const { nodes, edges } = raw;
  if (!Array.isArray(nodes)) return { ok: false, error: "nodes must be an array" };
  if (!Array.isArray(edges)) return { ok: false, error: "edges must be an array" };
  const validNodes: AddSubgraphNodeInputWire[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!isPlainObject(n)) return { ok: false, error: `nodes[${i}] must be an object` };
    const nAllowed = new Set(["tempId", "kind", "spec", "existingParents"]);
    for (const k of Object.keys(n)) {
      if (!nAllowed.has(k)) {
        return { ok: false, error: `nodes[${i}] has unknown key "${k}"` };
      }
    }
    if (typeof n.tempId !== "string" || n.tempId.length === 0) {
      return { ok: false, error: `nodes[${i}].tempId must be a non-empty string` };
    }
    if (typeof n.kind !== "string" || !(KNOWN_NODE_KINDS as readonly string[]).includes(n.kind)) {
      return {
        ok: false,
        error: `nodes[${i}].kind must be one of: ${KNOWN_NODE_KINDS.join(", ")}`,
      };
    }
    if (n.spec === undefined) {
      return { ok: false, error: `nodes[${i}].spec is required` };
    }
    let existingParents: readonly string[] | undefined;
    if (n.existingParents !== undefined) {
      if (!Array.isArray(n.existingParents)) {
        return { ok: false, error: `nodes[${i}].existingParents must be an array` };
      }
      for (const p of n.existingParents) {
        if (typeof p !== "string" || p.length === 0) {
          return {
            ok: false,
            error: `nodes[${i}].existingParents entries must be non-empty strings`,
          };
        }
      }
      existingParents = n.existingParents as readonly string[];
    }
    validNodes.push({
      tempId: n.tempId,
      kind: n.kind as AddSubgraphNodeInputWire["kind"],
      spec: n.spec,
      ...(existingParents !== undefined ? { existingParents } : {}),
    });
  }
  const validEdges: AddSubgraphEdgeInputWire[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    if (!isPlainObject(e)) return { ok: false, error: `edges[${i}] must be an object` };
    const eAllowed = new Set(["from", "to"]);
    for (const k of Object.keys(e)) {
      if (!eAllowed.has(k)) {
        return { ok: false, error: `edges[${i}] has unknown key "${k}"` };
      }
    }
    const fromResult = validateNodeRefWire(e.from);
    if (!fromResult.ok) return { ok: false, error: `edges[${i}].from: ${fromResult.error}` };
    const toResult = validateNodeRefWire(e.to);
    if (!toResult.ok) return { ok: false, error: `edges[${i}].to: ${toResult.error}` };
    validEdges.push({ from: fromResult.value, to: toResult.value });
  }
  return { ok: true, value: { nodes: validNodes, edges: validEdges } };
}

export function validateReplaceNodeSpecBody(raw: unknown): ValidationResult<ReplaceNodeSpecBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  const allowed = new Set(["newSpec"]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
  }
  if (raw.newSpec === undefined) return { ok: false, error: "newSpec is required" };
  return { ok: true, value: { newSpec: raw.newSpec } };
}

export function validateFinishWorkflowBody(raw: unknown): ValidationResult<FinishWorkflowBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  const { kind } = raw;
  if (typeof kind !== "string" || !(KNOWN_FINISH_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      error: `kind must be one of: ${KNOWN_FINISH_KINDS.join(", ")}`,
    };
  }
  if (kind === "succeeded") {
    const allowed = new Set(["kind", "success"]);
    for (const k of Object.keys(raw)) {
      if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
    }
    const { success } = raw;
    if (success !== undefined) {
      if (!isPlainObject(success)) {
        return { ok: false, error: "success must be an object" };
      }
      for (const k of Object.keys(success)) {
        if (k !== "output") {
          return { ok: false, error: `success has unknown key "${k}"` };
        }
      }
      const out = (success as { output?: unknown }).output;
      if (out !== undefined && out !== null && typeof out !== "string") {
        return { ok: false, error: "success.output must be a string or null" };
      }
      return {
        ok: true,
        value: {
          kind: "succeeded",
          success: { output: out === undefined ? null : (out as string | null) },
        },
      };
    }
    return { ok: true, value: { kind: "succeeded" } };
  }
  // kind === "failed"
  const allowed = new Set(["kind", "failure"]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) return { ok: false, error: `request body has unknown key "${k}"` };
  }
  const { failure } = raw;
  if (!isPlainObject(failure)) {
    return { ok: false, error: "failure is required and must be an object" };
  }
  for (const k of Object.keys(failure)) {
    if (k !== "kind" && k !== "message") {
      return { ok: false, error: `failure has unknown key "${k}"` };
    }
  }
  const failureKind = (failure as { kind?: unknown }).kind;
  if (failureKind !== undefined && failureKind !== "coordinator") {
    return { ok: false, error: 'failure.kind must be "coordinator" when supplied' };
  }
  const message = (failure as { message?: unknown }).message;
  if (typeof message !== "string") {
    return { ok: false, error: "failure.message must be a string" };
  }
  return {
    ok: true,
    value: {
      kind: "failed",
      failure: { kind: "coordinator", message },
    },
  };
}

/**
 * Internal narrowed body shape used by the cancel-route handler.
 * Mirrors {@link CancelWorkflowBody} but with `kind` widened from
 * optional `"user"?` to required `"user"`, reflecting the
 * normalization the validator performs (omitted -> "user"). The wire
 * contract stays optional for callers; downstream code receives the
 * normalized value.
 */
export interface ValidatedCancelWorkflowBody {
  readonly cancellation: {
    readonly kind: "user";
    readonly message: string;
  };
}

export function validateCancelWorkflowBody(
  raw: unknown,
): ValidationResult<ValidatedCancelWorkflowBody> {
  if (!isPlainObject(raw)) return { ok: false, error: "request body must be an object" };
  for (const k of Object.keys(raw)) {
    if (k !== "cancellation") {
      return { ok: false, error: `request body has unknown key "${k}"` };
    }
  }
  const { cancellation } = raw;
  if (!isPlainObject(cancellation)) {
    return { ok: false, error: "cancellation is required and must be an object" };
  }
  for (const k of Object.keys(cancellation)) {
    if (k !== "kind" && k !== "message") {
      return { ok: false, error: `cancellation has unknown key "${k}"` };
    }
  }
  const kind = (cancellation as { kind?: unknown }).kind;
  if (kind !== undefined && kind !== "user") {
    return { ok: false, error: 'cancellation.kind must be "user" when supplied' };
  }
  const message = (cancellation as { message?: unknown }).message;
  if (typeof message !== "string") {
    return { ok: false, error: "cancellation.message must be a string" };
  }
  return {
    ok: true,
    value: { cancellation: { kind: "user", message } },
  };
}

/**
 * Translate the wire-shape {@link NodeRefWire} (structural-discriminator
 * union by `nodeId` vs `tempId` presence) to the substrate's
 * {@link NodeRef} (explicit-tag union). The wire form is JSON-friendly
 * (no extra discriminator field); the substrate form is type-friendly
 * (discriminated by `kind`). Pure projection — no validation here, the
 * caller has already proven the input is a valid wire shape.
 */
export function nodeRefFromWire(ref: NodeRefWire): NodeRef {
  if ("nodeId" in ref) return { kind: "existing", id: ref.nodeId };
  return { kind: "temp", tempId: ref.tempId };
}
