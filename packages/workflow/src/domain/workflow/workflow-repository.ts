import type { ResultAsync } from "neverthrow";
import type { WorkflowId } from "../workflow/workflow-id.js";
import type { WorkflowEntity } from "./workflow-entity.js";

/** Persistence fault atom for repository IO failures (the SQLite driver threw). */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

/** Business outcome for a missing workflow row. */
export type WorkflowNotFound = {
  readonly type: "WorkflowNotFound";
  readonly workflowId: string;
};

// ─── Rehydration corruption ──────────────────────────────────────
// Surfaced by `get` when a persisted row cannot be mapped back to a
// valid aggregate. The infrastructure mapper is the sole producer.

/**
 * A persisted row cannot be rehydrated into a valid aggregate. `subtype`
 * names the specific corruption class; the optional `field` / `value` /
 * `allowed` carry diagnostics for logging (never surfaced on the wire).
 */
export type WorkflowInvariantViolation = {
  readonly type: "WorkflowInvariantViolation";
  readonly subtype: "corruption" | "enumValue" | "nodeKindShape" | "nodeKindValue";
  readonly field?: string;
  readonly value?: unknown;
  readonly allowed?: readonly string[];
};

/** Corruption atoms emitted when the mapper rehydrates a persisted row. */
export type WorkflowEntityCorruption = WorkflowInvariantViolation;

/** CQRS write-side repository for the mutable workflow aggregate. */
export interface WorkflowRepository {
  get(
    id: WorkflowId,
  ): ResultAsync<WorkflowEntity, WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable>;
  /**
   * Upserts the aggregate: inserts a never-persisted workflow, otherwise applies
   * a targeted diff against the loaded snapshot.
   */
  save(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable>;
  /** Hard-deletes the workflow row and its nodes/edges. */
  delete(id: WorkflowId): ResultAsync<void, DatabaseUnavailable>;
}
