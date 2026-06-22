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
  composeApplication,
} from "./application.js";
export { listRoutes } from "./route-manifest.js";
export { TaskScheduleTargetError } from "./wiring/schedule-task-handler.js";
export { WorkflowScheduleTargetError } from "./wiring/schedule-workflow-handler.js";
export {
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
} from "./wiring/workflow-coord-task-runner.js";
export { WorkflowWorkerSpecError } from "./wiring/workflow-worker-task-runner.js";
export {
  type WorkspaceContext,
  type WorkspaceContextState,
  WorkspaceHasLiveTasksError,
  WorkspaceLoadError,
} from "./workspace-context.js";
