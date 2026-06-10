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
 * path helpers) live in the sibling `@glyphs-ai/contracts` pkg. This
 * barrel re-exports them so `@glyphs-ai/server` has a single import
 * site for both orchestration and contracts — `@glyphs-ai/dashboard`
 * and `@glyphs-ai/cli` should depend on `@glyphs-ai/contracts`
 * directly, which keeps orchestration out of their dep graph
 * structurally (not just by convention).
 *
 * See `docs/architecture.md § Tier model` for the full layering
 * rationale.
 */

// Re-export every wire contract from the sibling pkg so server can
// `import { ... } from "@glyphs-ai/api"` and get both layers in one shot.
export * from "@glyphs-ai/contracts";
// Orchestration (composeApplication + per-workspace WorkspaceContext)
export {
  type Application,
  type ApplicationOpts,
  composeApplication,
} from "./application.js";
export { makeTaskKindHandler, TaskScheduleTargetError } from "./wiring/schedule-task-handler.js";
export {
  type CoordNodeSpec,
  DEFAULT_COORD_MAX_POLL_ERRORS,
  DEFAULT_COORD_POLL_INTERVAL_MS,
  type MakeCoordNodeRunnerOpts,
  makeCoordNodeRunner,
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
} from "./wiring/workflow-coord-task-runner.js";
export {
  DEFAULT_WORKER_MAX_POLL_ERRORS,
  DEFAULT_WORKER_POLL_INTERVAL_MS,
  type MakeWorkerNodeRunnerOpts,
  makeWorkerNodeRunner,
  type WorkerNodeSpec,
  WorkflowWorkerSpecError,
} from "./wiring/workflow-task-runner.js";
export { type WorkspaceContext, WorkspaceHasLiveTasksError } from "./workspace-context.js";
