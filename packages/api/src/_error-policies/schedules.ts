/**
 * Problem table for the schedules routes.
 *
 * The schedule package is Result-native: use-cases return discriminated-union
 * error atoms (keyed on `type`), not error classes. This table maps each atom
 * `type` to an HTTP status + `title`, with a per-occurrence `detail` builder
 * that reproduces the interpolated message; the atom `type` is the wire
 * `code`, mirroring `workflows.ts`.
 *
 * ## Target-validation fallthrough
 *
 * The schedule pkg is kind-agnostic. The task/workflow kind handlers in
 * `packages/api/src/wiring/*` validate `data` during `handler.validate`; a
 * rejection surfaces as the `TargetValidationFailed` atom carrying the
 * `cause`. {@link respondScheduleError} unwraps that cause and resolves it
 * against this same table, which spreads in {@link TASK_TABLE} plus the two
 * `TaskTargetInvalid` / `WorkflowTargetInvalid` rows — callers don't read two
 * policy files to predict status.
 */

import type {
  CreateScheduleError,
  DeleteScheduleError,
  GetScheduleError,
  ListSchedulesError,
  PatchScheduleError,
  PreviewScheduleError,
  RunScheduleError,
} from "@glyphs-ai/schedule";
import type { Context } from "hono";
import type { DomainProblemTable, ProblemDef, ProblemTable } from "../_http-errors.js";
import { respondProblem } from "../_http-errors.js";
import type { TaskTargetInvalid } from "../wiring/schedule-task-handler.js";
import type { WorkflowTargetInvalid } from "../wiring/schedule-workflow-handler.js";
import { TASK_TABLE } from "./tasks.js";

/** Every atom a schedule route can surface (across all seven use-cases). */
export type ScheduleRouteError =
  | CreateScheduleError
  | PatchScheduleError
  | DeleteScheduleError
  | RunScheduleError
  | GetScheduleError
  | ListSchedulesError
  | PreviewScheduleError;

/** The atoms this table maps directly (all but `TargetValidationFailed`). */
type ScheduleErrorType = Exclude<ScheduleRouteError["type"], "TargetValidationFailed">;
type ScheduleRouteAtom = Extract<ScheduleRouteError, { type: ScheduleErrorType }>;

const INTERNAL = "internal error";

const SCHEDULE_ATOM_TABLE = {
  InvalidScheduleId: {
    status: 400,
    title: "Invalid schedule id",
    detail: (err) => `invalid schedule id: ${String(err.id)}`,
  },
  InvalidCronExpr: {
    status: 400,
    title: "Invalid cron expression",
    detail: (err) => `invalid cron expression "${err.expr}": ${err.reason}`,
  },
  InvalidTimezone: {
    status: 400,
    title: "Invalid timezone",
    detail: (err) => `invalid IANA timezone: "${err.tz}"`,
  },
  InvalidScheduleName: {
    status: 400,
    title: "Invalid schedule name",
    detail: () => "schedule name must be a non-empty string",
  },
  TargetKindImmutable: {
    status: 400,
    title: "Target kind immutable",
    detail: (err) =>
      `cannot change target.kind on schedule "${err.id}" (current="${err.current}", attempted="${err.attempted}")`,
  },
  ScheduleNotFound: {
    status: 404,
    title: "Schedule not found",
    detail: (err) => `schedule not found: ${err.id}`,
  },
  ScheduleKindMismatch: {
    status: 404,
    title: "Schedule kind mismatch",
    detail: (err) =>
      `schedule "${err.id}" has target.kind="${err.actual}", expected "${err.expected}"`,
  },
  ScheduleEnabled: {
    status: 409,
    title: "Schedule enabled",
    detail: (err) => `schedule "${err.id}" cannot be deleted while enabled; disable it first`,
  },
  ScheduleHasInFlight: {
    status: 409,
    title: "Schedule has in-flight dispatch",
    detail: (err) =>
      `schedule "${err.id}" cannot be deleted while a fired dispatch is still in flight`,
  },
  ScheduleKindNotRegistered: { status: 500, title: "Internal error", detail: () => INTERNAL },
  ScheduleCorruption: { status: 500, title: "Internal error", detail: () => INTERNAL },
  DatabaseUnavailable: { status: 500, title: "Internal error", detail: () => INTERNAL },
} satisfies DomainProblemTable<ScheduleRouteAtom>;

/**
 * Target-validation carriers from the kind handlers. Not part of the
 * schedule DU — surfaced when a task/workflow target fails `handler.validate`.
 */
const TARGET_TABLE: Readonly<Record<string, ProblemDef>> = {
  TaskTargetInvalid: {
    status: 400,
    title: "Task target invalid",
    detail: (err) => (err as unknown as TaskTargetInvalid).message,
  },
  WorkflowTargetInvalid: {
    status: 400,
    title: "Workflow target invalid",
    detail: (err) => (err as unknown as WorkflowTargetInvalid).message,
  },
};

/**
 * Merged schedule Problem table: schedule atoms + the shared {@link TASK_TABLE}
 * (a task use-case failure raised inside a schedule run propagates as a raw
 * task atom) + the target-validation carrier rows.
 */
export const schedulesErrorPolicy: ProblemTable = {
  ...(TASK_TABLE as ProblemTable),
  ...(SCHEDULE_ATOM_TABLE as unknown as ProblemTable),
  ...TARGET_TABLE,
};

/**
 * Respond to a schedule use-case error atom. Union-native: the atom's `type`
 * resolves against {@link schedulesErrorPolicy}; a `TargetValidationFailed`
 * unwraps its `cause` first so the kind handler's own DU resolves through the
 * same table.
 */
export function respondScheduleError(
  c: Context,
  err: unknown,
  opts: { readonly route: string; readonly meta?: Record<string, unknown> },
): Response {
  const target = isTargetValidationFailed(err) ? err.cause : err;
  return respondProblem(c, target, schedulesErrorPolicy, {
    route: opts.route,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
  });
}

function isTargetValidationFailed(
  err: unknown,
): err is { readonly type: "TargetValidationFailed"; readonly cause: unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: unknown }).type === "TargetValidationFailed"
  );
}
