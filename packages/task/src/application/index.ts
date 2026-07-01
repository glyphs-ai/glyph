/**
 * Application barrel: the curated domain surface + error atoms referenced by
 * use-case error unions and the server's error-mapping policy. Repository /
 * workspace / resolver atoms come from their port files; the runtime atoms
 * come from `@glyphs-ai/runtime`. The `TaskEntity`, drizzle schema / mapper /
 * row types, and the concrete adapters stay package-internal.
 */

// ─── runtime error atoms surfaced through task's use-case unions ──────
export type { RuntimeActivityReadFailed, RuntimeHeadlessLaunchFailed } from "@glyphs-ai/runtime";
// ─── task value objects (schemas + inferred types) ───────────────────
export { type TaskCancellation, TaskCancellationSchema } from "../domain/task-cancellation.js";
// ─── entity transition + corruption atoms ────────────────────────────
export type { CorruptedTask, InvalidTransition } from "../domain/task-entity.js";
export { type TaskFailure, TaskFailureSchema } from "../domain/task-failure.js";
// ─── task id value object ─────────────────────────────────────────────
// `InvalidTaskId` stays package-internal: `TaskEntity.fromStored` folds it
// into `CorruptedTask` (a stored invalid id IS corruption) and request-id
// validation surfaces a ZodError, so it never appears in a use-case union.
export { type TaskId, TaskIdSchema } from "../domain/task-id.js";
export type { TaskOrigin } from "../domain/task-origin.js";
// ─── repository atoms ─────────────────────────────────────────────────
export type {
  DatabaseUnavailable,
  OriginAggregate,
  TaskNotFound,
} from "../domain/task-repository.js";
// ─── sandbox (file port) atoms ────────────────────────────────────────
export type {
  ArtifactListingFailed,
  WorkdirMaterializationFailed,
  WorkdirRemovalFailed,
  WorkdirReservationFailed,
} from "../domain/task-sandbox.js";
export { type TaskStatus, TaskStatusSchema, type TerminalStatus } from "../domain/task-status.js";
export { type TaskSuccess, TaskSuccessSchema } from "../domain/task-success.js";
// ─── dispatch / lifecycle atoms (owned by their use-case / the supervisor) ───
export type {
  DispatchKernelEnvCollision,
  EntryNotReady,
  RuntimeDoesNotSupportTasks,
} from "./dispatch-task.js";
// ─── agent-resolution atoms + the blocked-reason shape ───────────────
export type {
  AgentNotFound,
  AgentResolutionFailed,
  BlockedReason,
} from "./ports/agent-resolver.js";
export type { ManagerShuttingDown } from "./supervision/index.js";
