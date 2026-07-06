/**
 * Problem table for the tasks + scheduled-tasks routes.
 *
 * `@glyphs-ai/task` returns errors as discriminated-union values (not
 * thrown classes), so the route catches a `Result.Err` value and passes it
 * through {@link respondTaskError}. Status + `title` derive from the value's
 * `.type` discriminator via {@link TASK_TABLE}; the per-occurrence `detail`
 * and extension members come from each row's builders. 5xx tech failures
 * collapse to the opaque `"internal error"` detail so a `cause` carrying DB
 * internals or host paths never reaches the wire (`respondProblem` also logs
 * them via `logFault`).
 *
 * Two atoms carry richer extensions the CLI / dashboard consume:
 *  - `EntryNotReady` → `{ agent, reason? }` (route-independent; the
 *    dashboard's `formatEntryNotReadyHint` CTA branches on `reason`).
 *  - `InvalidTransition` → `{ fromStatus, transition }` where `transition`
 *    is the verb (`"cancel"` / `"delete"`) the route supplies via
 *    `opts.transition`.
 */

import type {
  CancelTaskError,
  DeleteTaskError,
  DispatchTaskError,
  GetTaskActivityError,
  GetTaskActivityStreamError,
  GetTaskError,
  ListTasksError,
  ResolveArtifactPathError,
} from "@glyphs-ai/task";
import type { Context } from "hono";
import type { DomainProblemTable, ProblemTable, RespondProblemOpts } from "../_http-errors.js";
import { respondProblem } from "../_http-errors.js";

/** Every DU error value a task / scheduled-task route can surface from `.execute()`. */
export type TaskRouteError =
  | DispatchTaskError
  | GetTaskError
  | ListTasksError
  | CancelTaskError
  | DeleteTaskError
  | GetTaskActivityError
  | GetTaskActivityStreamError
  | ResolveArtifactPathError;

/** Fixed opaque detail for the task 5xx tech-failure rows. */
const INTERNAL = "internal error";

/**
 * `code → {status, title, detail?, extension?}` for every task union atom.
 * Also spread into the schedule + workflow tables (a task use-case failure
 * raised inside a schedule run or workflow node propagates as a raw task
 * atom), so `code = union type` resolves identically everywhere.
 */
export const TASK_TABLE = {
  TaskNotFound: { status: 404, title: "Task not found", detail: () => "task not found" },
  AgentNotFound: { status: 404, title: "Agent not found", detail: () => "agent not found" },
  RuntimeDoesNotSupportTasks: {
    status: 501,
    title: "Runtime does not support tasks",
    detail: () => "runtime does not support task dispatch",
  },
  DispatchKernelEnvCollision: {
    status: 422,
    title: "Dispatch kernel env collision",
    detail: () => "subprocess env key collides with a kernel key",
  },
  EntryNotReady: {
    status: 409,
    title: "Entry not ready",
    detail: () => "agent is not ready",
    extension: (err) => ({
      agent: err.agent,
      ...(err.reason !== undefined ? { reason: err.reason } : {}),
    }),
  },
  InvalidTransition: {
    status: 409,
    title: "Invalid transition",
    detail: () => "illegal task state transition",
    extension: (err, opts) => ({
      fromStatus: err.from,
      ...(opts.transition !== undefined ? { transition: opts.transition } : {}),
    }),
  },
  ManagerShuttingDown: {
    status: 503,
    title: "Manager shutting down",
    detail: () => "task manager is shutting down",
  },
  AgentUnresolvable: { status: 500, title: "Internal error", detail: () => INTERNAL },
  WorkdirFailed: { status: 503, title: "Internal error", detail: () => INTERNAL },
  DatabaseUnavailable: { status: 503, title: "Internal error", detail: () => INTERNAL },
  RuntimeHeadlessLaunchFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
  RuntimeActivityReadFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
  CorruptedTask: { status: 500, title: "Internal error", detail: () => INTERNAL },
  PurgeFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
} satisfies DomainProblemTable<TaskRouteError>;

export interface RespondTaskErrorOpts {
  readonly route: string;
  /** Verb for an `InvalidTransition` body (`"cancel"` / `"delete"`). */
  readonly transition?: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Render a task route's `Result.Err` DU value as an
 * `application/problem+json` response. Status + wire shape come from
 * {@link TASK_TABLE}; 5xx tech failures are logged + collapsed to the
 * opaque detail by `respondProblem`.
 */
export function respondTaskError(
  c: Context,
  err: TaskRouteError,
  opts: RespondTaskErrorOpts,
): Response {
  return respondProblem(c, err, TASK_TABLE as ProblemTable, {
    route: opts.route,
    ...(opts.transition !== undefined ? { transition: opts.transition } : {}),
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
  } satisfies RespondProblemOpts);
}
