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
 * This barrel gives `@glyphs-ai/server` a single import site for the
 * whole layer: the `composeApplication` root, the mountable route
 * factories, and the shared HTTP error / Problem-envelope surface the
 * routes and the server's error seam use. Dashboard and cli never
 * import it — they consume the same response shapes through the
 * generated `@glyphs-ai/sdk`, which keeps orchestration out of their
 * dep graph structurally, not just by convention.
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
export { TASK_TABLE, type TaskRouteError } from "./_error-policies/tasks.js";
export {
  type RespondWorkflowErrorOpts,
  respondWorkflowError,
  type WorkflowRouteError,
  workflowsErrorPolicy,
} from "./_error-policies/workflows.js";
export {
  type RespondWorkspaceErrorOpts,
  respondWorkspaceError,
  type WorkspaceRouteError,
} from "./_error-policies/workspaces.js";
export {
  type DomainProblemTable,
  logEvent,
  logFault,
  type ProblemDef,
  type ProblemTable,
  problemResponse,
  type ResolvedProblem,
  type RespondProblemOpts,
  readErrorCode,
  resolveProblem,
  respondError,
  respondProblem,
  SAFE_ERROR_NAMES,
  unmappedFaultMeta,
} from "./_http-errors.js";
// HTTP route helpers — shared OpenAPI app factory and error utilities.
// Consumed by `@glyphs-ai/server` (re-exports them to its own route
// modules) and by route modules co-located here in api.
export {
  createApiApp,
  errorResponse,
  finalizeOpenApiDoc,
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
// Problem envelope — the global HTTP error wire shape.
// Only the symbols external consumers (server middleware, tests, and
// downstream clients that hand-build a Problem) actually need are exposed.
// `kebabCase` / `problemTypeUri` / `PROBLEM_TYPE_PREFIX` / `PROBLEM_JSON_SCHEMA`
// / `ProblemInput` / `ProblemIssue` / `ProblemIssueSchema` / `ProblemSchema`
// stay package-private — `toProblem` derives the URI internally, the JSON
// schema is only used by the openapi finalizer inside the api package, and
// the extra issue types are implementation details of `validationProblem`.
export {
  PROBLEM_CONTENT_TYPE,
  type Problem,
  toProblem,
  validationProblem,
} from "./schemas/problem.js";
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
  type ScopeDbHandles,
  type WorkspaceContext,
  type WorkspaceContextState,
  WorkspaceHasLiveTasksError,
  WorkspaceLoadError,
} from "./workspace-context.js";
