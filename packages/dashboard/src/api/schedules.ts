// Schedules REST client. Mirrors the routes in
// `packages/contracts/src/routes.ts` (`schedule.create`,
// `schedule.update`, `schedule.list`, etc.). All schedule fields —
// target, trigger, runtime, and metadata — are editable from both
// the dashboard (Create/EditScheduleModal) and the CLI; server
// handlers live in `packages/server/src/routes/schedules.ts`.
//
// Mutation routes are URL-discriminated by `target.kind`:
// `POST /schedules/task` + `PATCH /schedules/task/:scheduleId` for the task
// kind. The PATCH body uses RFC 7396 deep-merge semantics on
// `target` (siblings preserved; `null` deletes `details` / `runtime`)
// and wholesale-replace on `trigger`.

import type {
  PreviewScheduleResult,
  Schedule,
  ScheduleWireTarget,
  WorkflowHeaderWire,
} from "@glyphs-ai/contracts";
import {
  fetchJson,
  fetchJsonWithErrorBody,
  jsonInit,
  mutateJson,
  workspacePrefix,
} from "./http.js";

/**
 * Wire-shape view of a schedule as the dashboard sees it. The server
 * projects the substrate's opaque `{ kind, data }` envelope to a
 * flat per-kind shape on the way out (`projectScheduleToWire`); the
 * dashboard supports both the task and workflow kinds, so we type
 * `target` as the full wire union.
 */
export type ScheduleView = Omit<Schedule, "target"> & { target: ScheduleWireTarget };

/**
 * Response shape for `GET /schedules/:scheduleId` — the entity plus the
 * server-computed cronstrue description (`describe`). The dashboard
 * never re-derives `describe` client-side; cronstrue isn't a
 * dashboard dep and the server is the single source of truth for
 * the locale + format (zh_CN, per the route handler).
 */
export interface ScheduleDetail extends ScheduleView {
  describe: string;
}

/**
 * Body for `PATCH /schedules/task/:scheduleId` — RFC 7396 deep-merge for
 * `target`, wholesale-replace for `trigger`, scalar-set for
 * `name` / `enabled`. Mirrors `TaskSchedulePatchBody` in the shared
 * route contracts (`packages/contracts/src/routes.ts`). Declared
 * locally rather than re-exported from `@glyphs-ai/schedule` because
 * the dashboard imports types only.
 *
 * - `name` / `enabled` — set if present, otherwise keep.
 * - `trigger` — wholesale replace; absent means keep.
 * - `target.agent` / `brief` — set if present; `null` rejected by the
 *   server (required fields; omit to keep).
 * - `target.details` / `runtime` — string sets; `null` deletes;
 *   absent keeps. `target.kind` MUST NOT be set (URL discriminates).
 */
export interface PatchScheduleBody {
  name?: string;
  enabled?: boolean;
  trigger?: { kind: "cron"; expr: string; tz: string };
  target?: {
    agent?: string;
    brief?: string;
    details?: string | null;
    runtime?: string | null;
  };
}

/** Response shape for `GET /schedules/:scheduleId/preview?n=N`. */
export type SchedulePreview = PreviewScheduleResult;

export interface ListSchedulesOpts {
  /** Filter by target agent FQN (e.g. `"official/engineer"`). */
  agent?: string;
  /** Filter by enabled state. */
  enabled?: boolean;
}

export const listSchedules = (opts: ListSchedulesOpts = {}): Promise<ScheduleView[]> => {
  const qs = new URLSearchParams();
  if (opts.agent !== undefined) qs.set("agent", opts.agent);
  if (opts.enabled !== undefined) qs.set("enabled", opts.enabled ? "true" : "false");
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<ScheduleView[]>(`${workspacePrefix()}/schedules${suffix}`, "schedules");
};

export const getSchedule = (scheduleId: string): Promise<ScheduleDetail> =>
  fetchJson<ScheduleDetail>(
    `${workspacePrefix()}/schedules/${encodeURIComponent(scheduleId)}`,
    "schedule",
  );

export interface PreviewScheduleOpts {
  /** Number of upcoming fire times to compute. Server clamps to `[1, 100]` and defaults to 3. */
  n?: number;
}

export const previewSchedule = (
  scheduleId: string,
  opts: PreviewScheduleOpts = {},
): Promise<SchedulePreview> => {
  const qs = new URLSearchParams();
  if (opts.n !== undefined) qs.set("n", String(opts.n));
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<SchedulePreview>(
    `${workspacePrefix()}/schedules/${encodeURIComponent(scheduleId)}/preview${suffix}`,
    "schedule preview",
  );
};

export const patchSchedule = (scheduleId: string, body: PatchScheduleBody): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(
    `${workspacePrefix()}/schedules/task/${encodeURIComponent(scheduleId)}`,
    jsonInit("PATCH", body as object),
  );

/** Body for `PATCH /schedules/workflow/:scheduleId`. */
export interface PatchWorkflowScheduleBody {
  name?: string;
  enabled?: boolean;
  trigger?: { kind: "cron"; expr: string; tz: string };
  target?: {
    coordinatorAgent?: string;
    brief?: string;
    details?: string | null;
  };
}

export const patchWorkflowSchedule = (
  scheduleId: string,
  body: PatchWorkflowScheduleBody,
): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(
    `${workspacePrefix()}/schedules/workflow/${encodeURIComponent(scheduleId)}`,
    jsonInit("PATCH", body as object),
  );

export const deleteSchedule = (scheduleId: string): Promise<{ deletedDispatchCount: number }> =>
  mutateJson<{ deletedDispatchCount: number }>(
    `${workspacePrefix()}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: "DELETE" },
  );

export const runSchedule = (scheduleId: string): Promise<{ dispatchId: string }> =>
  mutateJson<{ dispatchId: string }>(
    `${workspacePrefix()}/schedules/${encodeURIComponent(scheduleId)}/run`,
    {
      method: "POST",
    },
  );

/**
 * Body for `POST /api/workspaces/:workspaceId/schedules/task` — mirrors the
 * server route's accepted shape
 * (`packages/server/src/routes/schedules.ts` `app.post("/task")`).
 * URL-discriminated by `target.kind` (no `kind` field on the body).
 * The dashboard's "New schedule" modal is the first surface to use
 * this; the CLI's `glyph schedule create` sends the same wire shape
 * directly. The `target.brief` + optional `target.details` pair mirrors
 * `@glyphs-ai/task` `DispatchOpts`.
 */
export interface CreateScheduleBody {
  name: string;
  target: { agent: string; brief: string; details?: string; runtime?: string };
  trigger: { kind: "cron"; expr: string; tz: string };
  enabled?: boolean;
}

/**
 * Create a task-kind schedule. Surfaces server-side validation errors
 * verbatim (typed envelope `{ error, code }`) via the shared
 * `extractError` helper — the modal renders these inline so the user
 * sees, e.g., "Invalid cron expression: …" rather than a generic
 * "schedule create: 400".
 */
export const createSchedule = (body: CreateScheduleBody): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(`${workspacePrefix()}/schedules/task`, jsonInit("POST", body));

/** Body for `POST /schedules/workflow`. */
export interface CreateWorkflowScheduleBody {
  name: string;
  target: { coordinatorAgent: string; brief: string; details?: string };
  trigger: { kind: "cron"; expr: string; tz: string };
  enabled?: boolean;
}

/** Create a workflow-kind schedule. */
export const createWorkflowSchedule = (body: CreateWorkflowScheduleBody): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(`${workspacePrefix()}/schedules/workflow`, jsonInit("POST", body));

/**
 * List workflows launched by schedules, optionally filtered to one
 * schedule. The route contract (`workflows.scheduled.list`) responds
 * with `WorkflowHeaderWire[]`, so the dashboard reads the typed shape
 * directly rather than re-narrowing an `unknown[]` at every call site.
 */
export const listScheduledWorkflows = (opts: {
  scheduleId?: string;
}): Promise<WorkflowHeaderWire[]> => {
  const qs = new URLSearchParams();
  if (opts.scheduleId !== undefined) qs.set("scheduleId", opts.scheduleId);
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<WorkflowHeaderWire[]>(
    `${workspacePrefix()}/scheduled-workflows${suffix}`,
    "scheduled-workflows",
  );
};

export interface PreviewCronArgs {
  expr: string;
  tz: string;
  /** Number of upcoming fires to compute. Server bounds `[1, 100]`; defaults to 5. */
  n?: number;
}

/**
 * Unscoped cron preview. Calls the new
 * `GET /api/workspaces/:workspaceId/schedules/preview-cron?expr=&tz=&n=`
 * route so the "New schedule" modal can show `describe` + next-N
 * fires while the user is still authoring an expression, with no
 * saved entity required.
 *
 * Uses the error-preserving `fetchJsonWithErrorBody` path so the
 * modal can surface the server's `error` string ("Invalid cron
 * expression: …" / "Unknown timezone: …") inline. The plain
 * `fetchJson` helper discards the body and throws
 * `"schedule preview: 400"`, which is not acceptable UX for a live
 * preview surface.
 *
 * The optional `signal` parameter forwards an `AbortSignal` to the
 * underlying `fetch(...)` so callers (notably the debounced live
 * preview in `CreateScheduleModal`) can cancel an in-flight request
 * when a newer one supersedes it. Aborted requests reject with
 * `DOMException { name: "AbortError" }`; callers should filter that
 * shape out of their error UI.
 */
export const previewCron = (
  args: PreviewCronArgs,
  signal?: AbortSignal,
): Promise<SchedulePreview> => {
  const qs = new URLSearchParams({ expr: args.expr, tz: args.tz });
  if (args.n !== undefined) qs.set("n", String(args.n));
  return fetchJsonWithErrorBody<SchedulePreview>(
    `${workspacePrefix()}/schedules/preview-cron?${qs.toString()}`,
    signal,
  );
};
