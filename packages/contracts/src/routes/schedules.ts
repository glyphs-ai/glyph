/**
 * Schedule routes (workspace-scoped) plus their request / response wire
 * shapes. Task-kind and workflow-kind schedules are URL-discriminated
 * (the body carries no `target.kind`); the preview routes are read-only
 * cron projections.
 */

import type { PreviewScheduleResult, Schedule } from "@glyphs-ai/schedule";
import type {
  ScheduleTarget,
  TaskTargetData,
  TaskTargetPatch,
  WorkflowTargetData,
  WorkflowTargetPatch,
} from "../schedules.js";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";
import type { WorkspacePathParams } from "./workspaces.js";

/** GET /api/workspaces/:id/schedules query params. */
export interface ScheduleListQuery {
  /** Filter to schedules whose `target.agent` matches this exact value. */
  readonly agent?: string;
  /** Filter on `enabled` flag. `"true"` / `"false"` (string per query convention). */
  readonly enabled?: "true" | "false";
}

/**
 * POST /api/workspaces/:id/schedules/task body. Kind-discriminated
 * by URL — the body carries no `target.kind` (the server injects
 * `"task"` before forwarding to `ScheduleService.createTask`).
 *
 * `trigger.tz` is required at the wire layer (the schedule service
 * itself does NOT default a timezone — every fire is timezone-anchored,
 * so the user must commit to one explicitly). If callers want UTC,
 * they pass `"UTC"`.
 */
export interface CreateTaskScheduleRequest {
  readonly name: string;
  readonly target: TaskTargetData;
  readonly trigger: {
    readonly kind: "cron";
    readonly expr: string;
    readonly tz: string;
  };
  readonly enabled?: boolean;
}

/**
 * PATCH /api/workspaces/:id/schedules/task/:sid body — RFC 7396
 * deep-merge for `target`, wholesale-replace for `trigger`,
 * scalar-set for `name` / `enabled`.
 *
 * - `name` / `enabled` — set if present, otherwise keep existing.
 * - `trigger` — wholesale replace if present (small atomic shape; no
 *   partial trigger; `null` rejected).
 * - `target` — RFC 7396 deep-merge per field:
 *     - `agent` / `brief`: set if present; `null` rejected (required
 *       fields — omit to keep existing).
 *     - `details` / `runtime`: string sets, `null` deletes, absent keeps.
 *   `target.kind` MUST NOT be set (URL discriminates).
 */
export interface PatchTaskScheduleRequest {
  readonly name?: string;
  readonly target?: TaskTargetPatch;
  readonly trigger?: CreateTaskScheduleRequest["trigger"];
  readonly enabled?: boolean;
}

/**
 * POST /api/workspaces/:id/schedules/workflow body — create a workflow-kind
 * schedule. URL-discriminated by `target.kind` so the body carries no
 * `kind` field. Mirrors `CreateTaskScheduleRequest` shape but the target is
 * `WorkflowTargetData` (coordinatorAgent + brief + optional details).
 */
export interface CreateWorkflowScheduleRequest {
  readonly name: string;
  readonly target: WorkflowTargetData;
  readonly trigger: {
    readonly kind: "cron";
    readonly expr: string;
    readonly tz: string;
  };
  readonly enabled?: boolean;
}

/**
 * PATCH /api/workspaces/:id/schedules/workflow/:sid body — RFC 7396
 * deep-merge for `target`, wholesale-replace for `trigger`,
 * scalar-set for `name` / `enabled`.
 *
 * - `coordinatorAgent` / `brief`: set if present; `null` rejected
 *   (required fields — omit to keep existing).
 * - `details`: string sets, `null` deletes, absent keeps.
 * - `target.kind` MUST NOT be set (URL discriminates).
 */
export interface PatchWorkflowScheduleRequest {
  readonly name?: string;
  readonly target?: WorkflowTargetPatch;
  readonly trigger?: CreateWorkflowScheduleRequest["trigger"];
  readonly enabled?: boolean;
}

/** Path params for per-schedule routes. */
export interface SchedulePathParams {
  /** Workspace id (UUID). */
  readonly id: string;
  /** Schedule id (UUID v4). */
  readonly sid: string;
}

/**
 * GET /api/workspaces/:id/schedules/:sid response. Mirrors `Schedule`
 * but adds a derived `describe` field (zh_CN human-readable cron
 * text) so the dashboard and `glyph schedule show` can render it
 * without a second round-trip. The field is computed on the response
 * — it is NOT persisted on the entity (the underlying cron
 * expression is the single source of truth; persisting `describe`
 * would require keeping it in sync on every patch + a migration).
 *
 * The `target` field is the FLAT wire shape (`ScheduleTarget`),
 * not the internal envelope — the server's `projectScheduleHeader`
 * helper converts on the way out. Dashboard / CLI code keeps
 * reading `schedule.target.agent` etc.
 */
export interface ScheduleGetResponse extends Omit<Schedule, "target"> {
  readonly target: ScheduleTarget;
  readonly describe: string;
}

/**
 * GET / list response item. Same flat-target projection as
 * {@link ScheduleGetResponse} but without the derived `describe`
 * field (list endpoints stay terse).
 */
export type ScheduleHeader = Omit<Schedule, "target"> & {
  readonly target: ScheduleTarget;
  /** Present only for workflow-kind schedules; omitted for task schedules. */
  readonly fireStats?: {
    readonly awaitingCount: number;
    readonly runningCount: number;
  };
};

/**
 * GET /api/workspaces/:id/schedules/:sid/preview query params.
 *
 * `n` is optional and validated as integer in `[1, 100]` at both the
 * route boundary and inside `ScheduleService.preview`. The double
 * check keeps each layer self-defending: the route emits a typed 400
 * envelope before reaching the service; the service still rejects an
 * out-of-range value if invoked directly by tests.
 */
export interface SchedulePreviewQuery {
  readonly n?: string;
}

/**
 * GET /api/workspaces/:id/schedules/preview-cron query params.
 *
 * Unscoped sibling of {@link SchedulePreviewQuery} for previewing an
 * arbitrary cron expression without a saved entity — used by the
 * dashboard's "New schedule" modal. `expr` and `tz` are
 * required (route returns 400 if missing or blank); `n` is optional,
 * defaults to **5** (modal default; differs from `/:sid/preview`'s
 * default of 3), bounded `[1, 100]` with strict integer parsing.
 */
export interface SchedulePreviewCronQuery {
  readonly expr: string;
  readonly tz: string;
  readonly n?: string;
}

/**
 * DELETE /api/workspaces/:id/schedules/:sid response.
 *
 * Cascade-delete semantics (see `ScheduleService.delete`): the
 * trigger is removed AND every TERMINAL unit-of-work the schedule
 * ever fired is purged via the registered kind handler's
 * `deleteForSchedule` (for the task kind, that's terminal tasks).
 * `deletedDispatchCount` is the number of historical rows the
 * handler removed in the same operation. In-flight dispatches are
 * protected by the pre-flight 409 (`SCHEDULE_HAS_INFLIGHT`) — they
 * are never touched by the cascade.
 *
 * Surfaced in: CLI suffix ("schedule X removed (and N historical
 * dispatches)"), dashboard confirm-modal post-delete toast.
 */
export interface ScheduleDeleteResponse {
  readonly ok: true;
  readonly deletedDispatchCount: number;
}

/**
 * POST /api/workspaces/:id/schedules/:sid/run response. The
 * substrate-side id of the unit-of-work the kind handler dispatched
 * — for the task kind, that's the new task id.
 */
export interface ScheduleRunResponse {
  readonly dispatchId: string;
}

export const scheduleRoutes = {
  "schedules.list": defineRoute<
    { params: WorkspacePathParams; query: ScheduleListQuery },
    readonly ScheduleHeader[]
  >("GET", "/api/workspaces/:id/schedules"),
  /**
   * Create a task-kind schedule. URL-discriminated by `target.kind`
   * so the body can omit `kind` (the URL declares it) — the server
   * narrows the body to `TaskTargetData` then calls
   * `service.create({ name, trigger, target: { kind: "task", data }, enabled })`.
   */
  "schedules.task.create": defineRoute<
    { params: WorkspacePathParams; body: CreateTaskScheduleRequest },
    ScheduleHeader
  >("POST", "/api/workspaces/:id/schedules/task"),
  "schedules.get": defineRoute<{ params: SchedulePathParams }, ScheduleGetResponse>(
    "GET",
    "/api/workspaces/:id/schedules/:sid",
  ),
  /**
   * Patch a task-kind schedule with RFC 7396 deep-merge semantics
   * on `target` (siblings preserved; `null` deletes optional fields),
   * wholesale-replace on `trigger`, and scalar-set on
   * `name` / `enabled`. URL-discriminated by `target.kind`: the
   * server passes `expectedKind: "task"` to `service.patch`; if
   * `:sid` exists but its `target.kind !== "task"` the service
   * throws `ScheduleKindMismatchError` which the route projects to
   * a generic 404 envelope (no kind-information leak).
   */
  "schedules.task.patch": defineRoute<
    { params: SchedulePathParams; body: PatchTaskScheduleRequest },
    ScheduleHeader
  >("PATCH", "/api/workspaces/:id/schedules/task/:sid"),
  /**
   * Create a workflow-kind schedule. URL-discriminated by `target.kind`
   * so the body carries no `kind` field — the server narrows the body
   * to `WorkflowTargetData` then calls
   * `service.create({ name, trigger, target: { kind: "workflow", data }, enabled })`.
   */
  "schedules.workflow.create": defineRoute<
    { params: WorkspacePathParams; body: CreateWorkflowScheduleRequest },
    ScheduleHeader
  >("POST", "/api/workspaces/:id/schedules/workflow"),
  /**
   * Patch a workflow-kind schedule with RFC 7396 deep-merge semantics
   * on `target` (siblings preserved; `null` deletes optional fields),
   * wholesale-replace on `trigger`, and scalar-set on
   * `name` / `enabled`. URL-discriminated by `target.kind`: the
   * server passes `expectedKind: "workflow"` to `service.patch`; if
   * `:sid` exists but its `target.kind !== "workflow"` the service
   * throws `ScheduleKindMismatchError` which the route projects to
   * a generic 404 envelope (no kind-information leak).
   */
  "schedules.workflow.patch": defineRoute<
    { params: SchedulePathParams; body: PatchWorkflowScheduleRequest },
    ScheduleHeader
  >("PATCH", "/api/workspaces/:id/schedules/workflow/:sid"),
  "schedules.delete": defineRoute<{ params: SchedulePathParams }, ScheduleDeleteResponse>(
    "DELETE",
    "/api/workspaces/:id/schedules/:sid",
  ),
  /**
   * Manual fire-now. Server invokes `ScheduleService.run(sid)` which
   * dispatches through the registered kind handler under the same
   * code path as a cron-driven fire. Does NOT advance the schedule's
   * `lastFiredAt` / `nextFireAt` cursor — manual runs are out-of-band
   * and the next cron fire still lands on its expected wall clock.
   *
   * Returns `{ dispatchId }` (the handler's substrate-side id —
   * for the task kind, that's the task id) so the caller can poll /
   * cancel the resulting unit-of-work without a second round-trip.
   */
  "schedules.run": defineRoute<{ params: SchedulePathParams }, ScheduleRunResponse>(
    "POST",
    "/api/workspaces/:id/schedules/:sid/run",
  ),
  /**
   * Read-only — compute the next N fires for this schedule from now,
   * plus a zh_CN human-readable description of the cron expression.
   * Does not touch state. `n` is bounded in `[1, 100]` (see
   * {@link SchedulePreviewQuery}).
   */
  "schedules.preview": defineRoute<
    { params: SchedulePathParams; query: SchedulePreviewQuery },
    PreviewScheduleResult
  >("GET", "/api/workspaces/:id/schedules/:sid/preview"),
  /**
   * Unscoped preview for an arbitrary `(expr, tz)` pair.
   * Wraps `ScheduleService.preview(expr, tz, n)` directly without
   * an entity lookup so the dashboard's "New schedule" modal can
   * render `{ describe, nextRuns }` while the user is still typing.
   * `n` defaults to 5 (modal preview count); same `[1, 100]` bound
   * as `/:sid/preview`. MUST be mounted before `/:sid` so the
   * literal path wins over `:sid = "preview-cron"`.
   */
  "schedules.cron.preview": defineRoute<
    { params: WorkspacePathParams; query: SchedulePreviewCronQuery },
    PreviewScheduleResult
  >("GET", "/api/workspaces/:id/schedules/preview-cron"),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
