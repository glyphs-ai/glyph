/**
 * Public domain surface shared across task use-cases: the branded `TaskId`,
 * the task value-object schemas, and the domain error atoms that use-case
 * error unions are built from. Application-layer atoms (dispatch / agent
 * resolution / supervision) and the per-use-case wire contracts are exposed
 * from the package root (`../index.ts`). The `TaskEntity`, drizzle schema /
 * mapper / row types, and the concrete adapters stay package-internal.
 */

// ─── artifact listing value object ───────────────────────────────────
export type { TaskArtifactFile } from "../domain/task-artifact.js";
// ─── task value objects (schemas + inferred types) ───────────────────
export { type TaskBrief, TaskBriefSchema } from "../domain/task-brief.js";
export { type TaskCancellation, TaskCancellationSchema } from "../domain/task-cancellation.js";
// ─── entity transition + corruption atoms ────────────────────────────
export type { CorruptedTask, InvalidTransition } from "../domain/task-entity.js";
export { type TaskFailure, TaskFailureSchema } from "../domain/task-failure.js";
// ─── task id value object ─────────────────────────────────────────────
// `InvalidTaskId` stays package-internal: `TaskEntity.rehydrate` folds it
// into `CorruptedTask` (a stored invalid id IS corruption) and request-id
// validation surfaces a ZodError, so it never appears in a use-case union.
export { type TaskId, TaskIdSchema } from "../domain/task-id.js";
export type { TaskOrigin } from "../domain/task-origin.js";
// ─── repository atoms ─────────────────────────────────────────────────
export type { DatabaseUnavailable, TaskNotFound } from "../domain/task-repository.js";
// ─── sandbox (file port) atoms ────────────────────────────────────────
export type {
  ArtifactListingFailed,
  WorkdirFailed,
} from "../domain/task-sandbox.js";
export { type TaskStatus, TaskStatusSchema, type TerminalStatus } from "../domain/task-status.js";
export { type TaskSuccess, TaskSuccessSchema } from "../domain/task-success.js";
