/**
 * @glyphs-ai/api — T2 Application layer (orchestration).
 *
 * Composes T0 foundations (`workspace`, `catalog`, `runtime`, `schedule`,
 * `terminal`) and T1 modes (`session`, `task`, `workflow`) into a
 * per-workspace runtime context via
 * `composeApplication`. The HTTP transport (`@glyphs-ai/server`) calls
 * this; UI surfaces (`@glyphs-ai/dashboard`, `@glyphs-ai/cli`) speak HTTP
 * and don't see this layer at all.
 *
 * Wire contracts (route catalog, request / response body types, leaf
 * path helpers) live in the `./wire` subtree. This barrel re-exports
 * them so `@glyphs-ai/server` has a single import site for both
 * orchestration and contracts. UI surfaces (`@glyphs-ai/dashboard`,
 * `@glyphs-ai/cli`) instead consume the same shapes through the
 * generated `@glyphs-ai/sdk`, which keeps orchestration out of their
 * dep graph structurally (not just by convention).
 *
 * See `docs/architecture.md § Tier model` for the full layering
 * rationale.
 */

export { catalogErrorPolicy } from "./_error-policies/catalog.js";
export {
  type RespondSessionErrorOpts,
  respondSessionError,
  type SessionRouteError,
} from "./_error-policies/sessions.js";
export {
  type TaskRouteError,
  taskErrorWireBody,
  taskUnionCodeStatuses,
} from "./_error-policies/tasks.js";
export {
  type ErrorPolicy,
  errorBody,
  INTERNAL_ERROR_NAMES,
  logEvent,
  logFault,
  type RespondErrorOpts,
  respondError,
  SAFE_ERROR_NAMES,
  unmappedFaultMeta,
} from "./_http-errors.js";
// HTTP route helpers — shared OpenAPI app factory and error utilities.
// Consumed by `@glyphs-ai/server` (re-exports them to its own route
// modules) and by route modules co-located here in api.
export { createApiApp, errorResponse, jsonRequest, jsonResponse } from "./_http-helpers.js";
// Orchestration (composeApplication + per-workspace WorkspaceContext)
export {
  type Application,
  composeApplication,
} from "./application.js";
// Route factories — each returns an OpenAPIHono sub-app mountable by
// the server's transport layer.
export { type CatalogResolver, catalogRoutes } from "./routes/catalog/index.js";
export { scheduledTasksRoutes } from "./routes/scheduled-tasks.js";
export { sessionsRoutes } from "./routes/sessions.js";
export { tasksRoutes } from "./routes/tasks.js";
export { workspacesRoutes } from "./routes/workspaces.js";
// Transport-agnostic zod schemas mirroring every wire contract. The
// OpenAPI projection in `@glyphs-ai/server` consumes these; other
// (non-HTTP) consumers can reuse them without an HTTP round-trip.
export * from "./schemas/index.js";
// Re-export every wire contract from the `./wire` subtree so server can
// `import { ... } from "@glyphs-ai/api"` and get both layers in one shot.
export * from "./wire/index.js";
export { TaskOperationError } from "./wiring/_task-operation-error.js";
export { TaskScheduleTargetError } from "./wiring/schedule-task-handler.js";
export { WorkflowScheduleTargetError } from "./wiring/schedule-workflow-handler.js";
export {
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
} from "./wiring/workflow-coord-task-runner.js";
export { WorkflowHumanSpecError } from "./wiring/workflow-human-node-runner.js";
export {
  WorkflowWorkerNotInCoordMenuError,
  WorkflowWorkerSpecError,
} from "./wiring/workflow-worker-task-runner.js";
export {
  type WorkspaceContext,
  type WorkspaceContextState,
  WorkspaceHasLiveTasksError,
  WorkspaceLoadError,
} from "./workspace-context.js";
