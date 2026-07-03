import type { ResultAsync } from "neverthrow";
import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";
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

/** A persisted scalar or payload shape is incompatible with the domain schema. */
export type WorkflowCorruption = {
  readonly type: "WorkflowCorruption";
  readonly field: string;
  readonly value: string;
  readonly allowed: readonly string[];
};

/** A persisted enum value is outside the current vocabulary. */
export type WorkflowEnumValueCorruption = {
  readonly type: "WorkflowEnumValueCorruption";
  readonly field: string;
  readonly value: string;
  readonly allowed: readonly string[];
};

/** A node kind value has the wrong scalar shape. */
export type WorkflowNodeKindShape = {
  readonly type: "WorkflowNodeKindShape";
  readonly value: unknown;
};

/** A string node kind is outside the closed substrate kind set. */
export type WorkflowNodeKindCorruption = {
  readonly type: "WorkflowNodeKindCorruption";
  readonly kind: string;
  readonly allowed: readonly WorkflowNodeKind[];
};

/** Corruption atoms emitted when the mapper rehydrates a persisted row. */
export type WorkflowEntityCorruption =
  | WorkflowCorruption
  | WorkflowEnumValueCorruption
  | WorkflowNodeKindShape
  | WorkflowNodeKindCorruption;

/** CQRS write-side repository for the mutable workflow aggregate. */
export interface WorkflowRepository {
  insert(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable>;
  get(
    id: WorkflowId,
  ): ResultAsync<WorkflowEntity, WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable>;
  save(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable>;
}
