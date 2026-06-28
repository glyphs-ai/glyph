import type { WorkflowNodeRef } from "@glyphs-ai/api";
import type { NodeRef } from "@glyphs-ai/workflow";
import type { ValidationResult } from "../_shared.js";

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

/**
 * Translate the wire-shape {@link WorkflowNodeRef} (structural-discriminator
 * union by `nodeId` vs `tempId` presence) to the substrate's
 * {@link NodeRef} (explicit-tag union). The wire form is JSON-friendly
 * (no extra discriminator field); the substrate form is type-friendly
 * (discriminated by `kind`). Pure projection — no validation here, the
 * caller has already proven the input is a valid wire shape.
 */
export function resolveNodeRef(ref: WorkflowNodeRef): NodeRef {
  if ("nodeId" in ref) return { kind: "existing", id: ref.nodeId };
  return { kind: "temp", tempId: ref.tempId };
}
