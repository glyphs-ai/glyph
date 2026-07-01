/**
 * Public surface of @glyphs-ai/task.
 *
 * A task is a headless, runtime-launched agent run persisted in the
 * per-workspace `workspace.db`. Schema-first, Result-based,
 * discriminated-union errors, no throws across the package boundary. Every
 * use-case implements `UseCase<Request, Response, Error>` and returns
 * `UseCaseResult = ResultAsync<Response, Error>`.
 *
 * Exports:
 *   - Per use-case: its `Request` + `Response` Zod schemas + inferred
 *     types and `Error` union — the wire contract. Each use-case owns its
 *     own request/response shape; there is no shared task DTO.
 *   - Curated domain surface via `./application/index.js`: the branded
 *     `TaskId`, the task value-object schemas (`TaskStatusSchema`,
 *     `TaskSuccessSchema`, …), and the error atoms the use-case error
 *     unions are built from.
 *   - The host-supplied `AgentResolver` port and the runtime data types
 *     adapter authors need (`ResolvedAgent`, `ActivityItem`, `ActivityResult`).
 *   - `composeTaskModule` → `TaskModule`: the DI container a host builds
 *     once and dispatches through.
 *
 * NOT exported (package-internal): use-case classes + their `Deps`, the
 * `TaskSupervisor`, `TaskEntity`, repository / workspace ports, drizzle
 * schema / mapper / row types, and the drizzle + file adapters — hosts
 * construct and call everything through `composeTaskModule`.
 *
 * Tier role: T1 (mode). No HTTP, no global state.
 */

// ─── runtime data types re-exported for adapter authors ────────────
export type { ActivityItem, ActivityResult, ResolvedAgent } from "@glyphs-ai/runtime";
export {
  type AggregateByOriginError,
  type AggregateByOriginRequest,
  AggregateByOriginRequestSchema,
  type AggregateByOriginResponse,
} from "./application/aggregate-by-origin.js";
export {
  type CancelTaskError,
  type CancelTaskRequest,
  CancelTaskRequestSchema,
  type CancelTaskResponse,
} from "./application/cancel-task.js";
export {
  type DeleteTaskError,
  type DeleteTaskRequest,
  DeleteTaskRequestSchema,
  type DeleteTaskResponse,
} from "./application/delete-task.js";
export {
  type DeleteTerminalByOriginError,
  type DeleteTerminalByOriginRequest,
  DeleteTerminalByOriginRequestSchema,
  type DeleteTerminalByOriginResponse,
} from "./application/delete-terminal-by-origin.js";
export {
  type DispatchTaskError,
  type DispatchTaskRequest,
  DispatchTaskRequestSchema,
  type DispatchTaskResponse,
  type UnsafeFramingPrompt,
} from "./application/dispatch-task.js";
export {
  type FindLatestByOriginError,
  type FindLatestByOriginRequest,
  FindLatestByOriginRequestSchema,
  type FindLatestByOriginResponse,
} from "./application/find-latest-by-origin.js";
export {
  type GetTaskError,
  type GetTaskRequest,
  GetTaskRequestSchema,
  type GetTaskResponse,
} from "./application/get-task.js";
export {
  type GetTaskActivityError,
  type GetTaskActivityRequest,
  GetTaskActivityRequestSchema,
  type GetTaskActivityResponse,
} from "./application/get-task-activity.js";
export {
  type GetTaskActivityStreamError,
  type GetTaskActivityStreamRequest,
  GetTaskActivityStreamRequestSchema,
  type GetTaskActivityStreamResponse,
} from "./application/get-task-activity-stream.js";
export {
  type HasInFlightByOriginError,
  type HasInFlightByOriginRequest,
  HasInFlightByOriginRequestSchema,
  type HasInFlightByOriginResponse,
} from "./application/has-in-flight-by-origin.js";
// ─── curated domain surface (TaskId, value-object schemas, error atoms) ─────────
// Funnelled through the application barrel so this file never mentions
// `./domain/*` directly — domain stays private to the package.
export * from "./application/index.js";
export {
  type ListInFlightByOriginError,
  type ListInFlightByOriginRequest,
  ListInFlightByOriginRequestSchema,
  type ListInFlightByOriginResponse,
} from "./application/list-in-flight-by-origin.js";
export {
  type ListTasksError,
  type ListTasksRequest,
  ListTasksRequestSchema,
  type ListTasksResponse,
} from "./application/list-tasks.js";
// ─── host-supplied ports ───────────────────────────────────────────
export type {
  AgentEntry,
  AgentResolver,
} from "./application/ports/agent-resolver.js";
export {
  type RecoverOrphanedTasksError,
  type RecoverOrphanedTasksRequest,
  RecoverOrphanedTasksRequestSchema,
  type RecoverOrphanedTasksResponse,
} from "./application/recover-orphaned-tasks.js";
export {
  type ResolveArtifactPathError,
  type ResolveArtifactPathRequest,
  ResolveArtifactPathRequestSchema,
  type ResolveArtifactPathResponse,
} from "./application/resolve-artifact-path.js";
// ─── use-case contract ─────────────────────────────────────────────
export type { UseCase, UseCaseResult } from "./application/use-case.js";
export {
  composeTaskModule,
  type TaskModule,
  type TaskModuleOptions,
} from "./task-module.js";
// ─── on-disk task layout contract (host artifact-path resolution) ──
export { TASK_ARTIFACT_SUBDIR, tasksRoot } from "./task-paths.js";
