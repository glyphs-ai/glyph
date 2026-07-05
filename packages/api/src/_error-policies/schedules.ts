/**
 * Union-native error policy for the schedules routes.
 *
 * The schedule package is Result-native: use-cases return discriminated-union
 * error atoms (keyed on `type`), not error classes. This policy maps each atom
 * `type` to an HTTP status + wire body via `codeStatuses` (the atom's `type`
 * is surfaced as the wire `code`), mirroring `workflows.ts`.
 *
 * ## Target-validation fallthrough
 *
 * The schedule pkg is kind-agnostic. The task/workflow kind handlers in
 * `packages/api/src/wiring/*` validate `data` during `handler.validate`; a
 * rejection surfaces as the {@link TargetValidationFailed} atom carrying the
 * `cause`. {@link respondScheduleError} unwraps that cause and delegates to
 * `respondError`, so a task/workflow target-validation atom (400) or a task
 * union atom resolves via the same `codeStatuses` tables the task routes use —
 * callers don't read two policy files to predict status.
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
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorPolicy, RespondErrorOpts } from "../_http-errors.js";
import { respondError } from "../_http-errors.js";
import type { TaskTargetInvalid } from "../wiring/schedule-task-handler.js";
import type { WorkflowTargetInvalid } from "../wiring/schedule-workflow-handler.js";
import { taskUnionCodeStatuses } from "./tasks.js";

type CodeStatusEntry = NonNullable<ErrorPolicy["codeStatuses"]>[number];

/** Every atom a schedule route can surface (across all seven use-cases). */
export type ScheduleRouteError =
  | CreateScheduleError
  | PatchScheduleError
  | DeleteScheduleError
  | RunScheduleError
  | GetScheduleError
  | ListSchedulesError
  | PreviewScheduleError;

/** The atoms this policy maps directly (all but `TargetValidationFailed`). */
type ScheduleErrorType = Exclude<ScheduleRouteError["type"], "TargetValidationFailed">;
type ScheduleRouteAtom = Extract<ScheduleRouteError, { type: ScheduleErrorType }>;

const STATUS_BY_TYPE: Readonly<Record<ScheduleErrorType, ContentfulStatusCode>> = {
  InvalidScheduleId: 400,
  InvalidCronExpr: 400,
  InvalidTimezone: 400,
  InvalidScheduleName: 400,
  TargetKindImmutable: 400,
  ScheduleNotFound: 404,
  ScheduleKindMismatch: 404,
  ScheduleEnabled: 409,
  ScheduleHasInFlight: 409,
  // Operator-config / data faults — 500 with an opaque body so the wire never
  // leaks the kind name or internal detail.
  ScheduleKindNotRegistered: 500,
  ScheduleCorruption: 500,
  DatabaseUnavailable: 500,
};

function scheduleWireBody(err: ScheduleRouteAtom): Record<string, unknown> {
  switch (err.type) {
    case "InvalidScheduleId":
      return { error: `invalid schedule id: ${String(err.id)}`, code: err.type };
    case "InvalidCronExpr":
      return { error: `invalid cron expression "${err.expr}": ${err.reason}`, code: err.type };
    case "InvalidTimezone":
      return { error: `invalid IANA timezone: "${err.tz}"`, code: err.type };
    case "InvalidScheduleName":
      return { error: "schedule name must be a non-empty string", code: err.type };
    case "TargetKindImmutable":
      return {
        error: `cannot change target.kind on schedule "${err.id}" (current="${err.current}", attempted="${err.attempted}")`,
        code: err.type,
      };
    case "ScheduleNotFound":
      return { error: `schedule not found: ${err.id}`, code: err.type };
    case "ScheduleKindMismatch":
      return {
        error: `schedule "${err.id}" has target.kind="${err.actual}", expected "${err.expected}"`,
        code: err.type,
      };
    case "ScheduleEnabled":
      return {
        error: `schedule "${err.id}" cannot be deleted while enabled; disable it first`,
        code: err.type,
      };
    case "ScheduleHasInFlight":
      return {
        error: `schedule "${err.id}" cannot be deleted while a fired dispatch is still in flight`,
        code: err.type,
      };
    case "ScheduleKindNotRegistered":
    case "ScheduleCorruption":
    case "DatabaseUnavailable":
      return { error: "internal error", code: err.type };
  }
}

function withCode(err: ScheduleRouteAtom): ScheduleRouteAtom & { readonly code: string } {
  return Object.assign(Object.create(null), err, { code: err.type });
}

function scheduleCodeStatus(type: ScheduleErrorType): CodeStatusEntry {
  return [type, STATUS_BY_TYPE[type], (err) => scheduleWireBody(err as ScheduleRouteAtom)];
}

export const schedulesErrorPolicy: ErrorPolicy = {
  name: "schedules",
  statuses: [],
  codeStatuses: [
    ...taskUnionCodeStatuses,
    ...(Object.keys(STATUS_BY_TYPE) as ScheduleErrorType[]).map(scheduleCodeStatus),
    [
      "TaskTargetInvalid",
      400,
      (err) => ({
        error: (err as TaskTargetInvalid).message,
        code: "TaskTargetInvalid",
      }),
    ],
    [
      "WorkflowTargetInvalid",
      400,
      (err) => ({
        error: (err as WorkflowTargetInvalid).message,
        code: "WorkflowTargetInvalid",
      }),
    ],
  ],
};

/**
 * Respond to a schedule use-case error atom. Union-native: wraps the atom so
 * its `type` resolves via `codeStatuses`; a `TargetValidationFailed` unwraps
 * its `cause` and delegates so the kind handler's own DU resolves through the
 * same policy.
 */
export function respondScheduleError(
  c: Context,
  err: unknown,
  opts: { readonly route: string; readonly meta?: Record<string, unknown> },
): Response {
  const full: RespondErrorOpts = { ...opts, policy: schedulesErrorPolicy };
  if (isTargetValidationFailed(err)) {
    return respondError(c, err.cause, full);
  }
  if (isScheduleRouteAtom(err)) {
    return respondError(c, withCode(err), full);
  }
  return respondError(c, err, full);
}

function isScheduleRouteAtom(err: unknown): err is ScheduleRouteAtom {
  if (typeof err !== "object" || err === null || !("type" in err)) return false;
  const type = (err as { type: unknown }).type;
  return typeof type === "string" && type in STATUS_BY_TYPE;
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
