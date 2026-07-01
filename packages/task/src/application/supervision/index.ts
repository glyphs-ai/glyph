/**
 * Barrel for the `supervision/` concern: the stateful `TaskSupervisor`, its
 * in-memory `InMemoryLiveProcessRegistry` (the live-subprocess index it
 * delegates handle mechanics to), and the supervisor-owned contracts the
 * use-cases + module wiring reference — the `runDispatch` input types
 * (`RunDispatchArgs` / `LaunchableRuntime` / `DEFAULT_RUNTIME`) and the
 * `ManagerShuttingDown` lifecycle atom. `terminal-decision.ts` stays internal
 * to the concern (only the supervisor uses it).
 */

export { InMemoryLiveProcessRegistry } from "./in-memory-live-process-registry.js";
export {
  DEFAULT_RUNTIME,
  type LaunchableRuntime,
  type ManagerShuttingDown,
  type RunDispatchArgs,
  TaskSupervisor,
  type TaskSupervisorDeps,
} from "./task-supervisor.js";
