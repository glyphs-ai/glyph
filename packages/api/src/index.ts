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
  respondScheduleError,
  type ScheduleRouteError,
  schedulesErrorPolicy,
} from "./_error-policies/schedules.js";
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
  respondWorkflowError,
  type WorkflowRouteError,
  workflowCustomDeleteBody,
  workflowsErrorPolicy,
} from "./_error-policies/workflows.js";
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
export {
  createApiApp,
  errorResponse,
  injectWorkspaceIdParam,
  jsonRequest,
  jsonResponse,
} from "./_http-helpers.js";
// Orchestration (composeApplication + per-workspace WorkspaceContext)
export {
  type Application,
  composeApplication,
} from "./application.js";
// Route factories — each returns an OpenAPIHono sub-app mountable by
// the server's transport layer.
export { type CatalogResolver, catalogRoutes } from "./routes/catalog/index.js";
export { configRoutes } from "./routes/config.js";
export { healthRoutes } from "./routes/health.js";
export { runtimesRoutes } from "./routes/runtimes.js";
export { scheduledTasksRoutes, schedulesTaskRoutes } from "./routes/schedules/scheduled-tasks.js";
export {
  scheduledWorkflowsRoutes,
  schedulesWorkflowRoutes,
} from "./routes/schedules/scheduled-workflows.js";
export { schedulesPreviewCronRoutes } from "./routes/schedules/schedules.js";
export { sessionsRoutes } from "./routes/sessions.js";
export { tasksRoutes } from "./routes/tasks.js";
export { workflowsRoutes } from "./routes/workflows.js";
export { workspacesRoutes } from "./routes/workspaces.js";
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
