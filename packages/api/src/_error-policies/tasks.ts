/**
 * Per-domain error response builder for the tasks + scheduled-tasks routes.
 *
 * `@glyphs-ai/task` returns errors as discriminated-union values (not
 * thrown classes), so the route catches a `Result.Err` value and passes it
 * through {@link respondTaskError}. Status + wire `code` derive from the
 * value's `.type` discriminator via the static tables below; 5xx tech
 * failures are logged via `logFault` and collapsed to an opaque body so a
 * `cause` carrying DB internals or host paths never reaches the wire.
 *
 * Two error atoms carry a richer, dashboard-consumed envelope:
 *  - `EntryNotReady` → `{ error, code, agent, reason? }` (route-independent;
 *    the dashboard's `formatEntryNotReadyHint` CTA branches on `reason`).
 *  - `InvalidTransition` → `{ error, code, status, transition }` where
 *    `transition` is the verb (`"cancel"` / `"delete"`) the route supplies
 *    via `opts.transition`.
 *
 * Malformed path ids are a separate path: the use-case re-parses its request
 * through the id schema and a malformed id surfaces as a thrown `ZodError`
 * that `createApiApp`'s onError renders as a 400.
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
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CodeStatusEntry } from "../_http-errors.js";
import { logFault } from "../_http-errors.js";
import { TaskOperationError } from "../wiring/_task-operation-error.js";

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

type TaskErrorType = TaskRouteError["type"];

const STATUS_BY_TYPE: Readonly<Record<TaskErrorType, ContentfulStatusCode>> = {
  TaskNotFound: 404,
  AgentNotFound: 400,
  RuntimeDoesNotSupportTasks: 400,
  DispatchKernelEnvCollision: 400,
  EntryNotReady: 409,
  InvalidTransition: 409,
  ManagerShuttingDown: 503,
  AgentResolutionFailed: 500,
  WorkdirReservationFailed: 500,
  WorkdirMaterializationFailed: 500,
  DatabaseUnavailable: 500,
  RuntimeHeadlessLaunchFailed: 500,
  RuntimeActivityReadFailed: 500,
  CorruptedTask: 500,
  PurgeFailed: 500,
};

const MESSAGE_BY_TYPE: Readonly<Record<TaskErrorType, string>> = {
  TaskNotFound: "task not found",
  AgentNotFound: "agent not found",
  RuntimeDoesNotSupportTasks: "runtime does not support task dispatch",
  DispatchKernelEnvCollision: "subprocess env key collides with a kernel key",
  EntryNotReady: "agent is not ready",
  InvalidTransition: "illegal task state transition",
  ManagerShuttingDown: "task manager is shutting down",
  AgentResolutionFailed: "internal error",
  WorkdirReservationFailed: "internal error",
  WorkdirMaterializationFailed: "internal error",
  DatabaseUnavailable: "internal error",
  RuntimeHeadlessLaunchFailed: "internal error",
  RuntimeActivityReadFailed: "internal error",
  CorruptedTask: "internal error",
  PurgeFailed: "internal error",
};

export interface RespondTaskErrorOpts {
  readonly route: string;
  /** Verb for an `InvalidTransition` body (`"cancel"` / `"delete"`). */
  readonly transition?: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Build the wire body for a task union error: `{ error, code }` plus the
 * two richer envelopes the dashboard / CLI consume. Shared by
 * {@link respondTaskError} (task + scheduled-task routes) and
 * {@link taskUnionCodeStatuses} (the schedule / workflow policies, which
 * catch the same union via the `TaskOperationError` carrier), so every task
 * error surfaces one `code = union type` + message table.
 */
export function taskErrorWireBody(
  err: TaskRouteError,
  transition?: string,
): Record<string, unknown> {
  if (err.type === "EntryNotReady") {
    return {
      error: MESSAGE_BY_TYPE.EntryNotReady,
      code: err.type,
      agent: err.agent,
      ...(err.reason !== undefined ? { reason: err.reason } : {}),
    };
  }
  if (err.type === "InvalidTransition") {
    return {
      error: MESSAGE_BY_TYPE.InvalidTransition,
      code: err.type,
      status: err.from,
      ...(transition !== undefined ? { transition } : {}),
    };
  }
  return { error: MESSAGE_BY_TYPE[err.type], code: err.type };
}

/**
 * Render a task route's `Result.Err` DU value as an HTTP response: status +
 * `code = err.type` from the static tables. 5xx tech failures emit the
 * structured `logFault` line and an opaque `"internal error"` body.
 */
export function respondTaskError(
  c: Context,
  err: TaskRouteError,
  opts: RespondTaskErrorOpts,
): Response {
  const status = STATUS_BY_TYPE[err.type];
  if (status >= 500) {
    logFault(c, err, `${opts.route}: 5xx fault`, opts.meta);
  }
  return c.json(taskErrorWireBody(err, opts.transition), status);
}

/**
 * `codeStatuses` rows shared by the schedule and workflow error policies. A
 * task use-case failure raised inside a schedule run or a workflow node is
 * wrapped in a `TaskOperationError` (carrying the union value as `.detail`);
 * these rows resolve its HTTP status from the shared {@link STATUS_BY_TYPE}
 * table — identical to the task routes — and build the body from `.detail`, so
 * `code` is the union `type` everywhere. The body builder guards on
 * `TaskOperationError` so a same-`code` error from another source falls back
 * to an opaque body rather than dereferencing a missing `.detail`.
 */
function taskCarrierWireBody(err: unknown): Record<string, unknown> {
  if (err instanceof TaskOperationError) {
    return taskErrorWireBody(err.detail as TaskRouteError);
  }
  return { error: "internal error" };
}

export const taskUnionCodeStatuses: ReadonlyArray<CodeStatusEntry> = (
  Object.keys(STATUS_BY_TYPE) as TaskErrorType[]
).map((type): CodeStatusEntry => [type, STATUS_BY_TYPE[type], taskCarrierWireBody]);
