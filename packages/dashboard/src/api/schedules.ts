// Schedules REST client. Mirrors the schedule routes the server exposes
// (`schedule.create`, `schedule.update`, `schedule.list`, etc.). All
// schedule fields — target, trigger, runtime, and metadata — are editable
// from both the dashboard (Create/EditScheduleModal) and the CLI; server
// handlers live in `packages/server/src/routes/schedules.ts`.
//
// Mutation routes are URL-discriminated by `target.kind`:
// `POST /schedules/task` + `PATCH /schedules/task/:scheduleId` for the task
// kind. The PATCH body uses RFC 7396 deep-merge semantics on
// `target` (siblings preserved; `null` deletes `details` / `runtime`)
// and wholesale-replace on `trigger`.
//
// Adapters whose response embeds the opaque `{ kind, data }` schedule
// `target` envelope (every `ScheduleView` / `ScheduleDetail` reader and
// writer) stay on the typed raw-fetch helpers: the server hand-validates
// those write bodies (typed `never` in the generated ops) and the OpenAPI
// projection widens `target.data` to optional, which does not assign to the
// domain `ScheduleTarget` (`data` required) the dashboard is typed against.
// The envelope-free routes (preview, run, delete, scheduled-workflows) use
// the generated SDK operations.

import type {
  CreateTaskScheduleRequest,
  CreateWorkflowScheduleRequest,
  PatchTaskScheduleRequest,
  PatchWorkflowScheduleRequest,
  PreviewScheduleResult,
  Schedule,
  ScheduleTarget,
  WorkflowHeader,
} from "@glyphs-ai/sdk";
import {
  deleteApiWorkspacesByIdSchedulesBySid,
  getApiWorkspacesByIdScheduledWorkflows,
  getApiWorkspacesByIdSchedulesBySidPreview,
  getApiWorkspacesByIdSchedulesPreviewCron,
  postApiWorkspacesByIdSchedulesBySidRun,
} from "@glyphs-ai/sdk";
import { fetchJson, jsonInit, mutateJson, workspacePrefix } from "./http.js";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";

/**
 * Wire-shape view of a schedule as the dashboard sees it. The server
 * projects the substrate's opaque `{ kind, data }` envelope to a
 * flat per-kind shape on the way out (`projectScheduleHeader`); the
 * dashboard supports both the task and workflow kinds, so we type
 * `target` as the full wire union.
 */
export type ScheduleView = Omit<Schedule, "target"> & {
  target: ScheduleTarget;
  fireStats?: {
    awaitingCount: number;
    runningCount: number;
  };
};

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
 * `name` / `enabled`. Mirrors the shared `PatchTaskScheduleRequest`
 * route contract. Declared locally rather than re-exported from
 * `@glyphs-ai/schedule` because the dashboard imports types only.
 *
 * - `name` / `enabled` — set if present, otherwise keep.
 * - `trigger` — wholesale replace; absent means keep.
 * - `target.agent` / `brief` — set if present; `null` rejected by the
 *   server (required fields; omit to keep).
 * - `target.details` / `runtime` — string sets; `null` deletes;
 *   absent keeps. `target.kind` MUST NOT be set (URL discriminates).
 *
 * Re-exported from the SDK as the single source of truth for the
 * wire shape — the dashboard does not redeclare it.
 */
export type { PatchTaskScheduleRequest as PatchScheduleRequest } from "@glyphs-ai/sdk";

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

export const previewSchedule = async (
  scheduleId: string,
  opts: PreviewScheduleOpts = {},
): Promise<SchedulePreview> => {
  const query: { n?: string } = {};
  if (opts.n !== undefined) query.n = String(opts.n);
  return unwrap(
    await getApiWorkspacesByIdSchedulesBySidPreview({
      path: { id: requireWorkspaceId(), sid: scheduleId },
      query,
    }),
  );
};

export const patchSchedule = (
  scheduleId: string,
  body: PatchTaskScheduleRequest,
): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(
    `${workspacePrefix()}/schedules/task/${encodeURIComponent(scheduleId)}`,
    jsonInit("PATCH", body as object),
  );

export const patchWorkflowSchedule = (
  scheduleId: string,
  body: PatchWorkflowScheduleRequest,
): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(
    `${workspacePrefix()}/schedules/workflow/${encodeURIComponent(scheduleId)}`,
    jsonInit("PATCH", body as object),
  );

export const deleteSchedule = async (
  scheduleId: string,
): Promise<{ deletedDispatchCount: number }> =>
  unwrap(
    await deleteApiWorkspacesByIdSchedulesBySid({
      path: { id: requireWorkspaceId(), sid: scheduleId },
    }),
  );

export const runSchedule = async (scheduleId: string): Promise<{ dispatchId: string }> =>
  unwrap(
    await postApiWorkspacesByIdSchedulesBySidRun({
      path: { id: requireWorkspaceId(), sid: scheduleId },
    }),
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
 *
 * Re-exported from the SDK so the dashboard always tracks the
 * canonical wire shape.
 */
export type { CreateTaskScheduleRequest as CreateScheduleRequest } from "@glyphs-ai/sdk";

/**
 * Create a task-kind schedule. Surfaces server-side validation errors
 * verbatim (typed envelope `{ error, code }`) via the shared
 * `ApiError` — the modal renders these inline so the user sees, e.g.,
 * "Invalid cron expression: …" rather than a generic "schedule create: 400".
 */
export const createSchedule = (body: CreateTaskScheduleRequest): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(`${workspacePrefix()}/schedules/task`, jsonInit("POST", body));

/** Body for `POST /schedules/workflow` — re-exported from the SDK. */
export type { CreateWorkflowScheduleRequest } from "@glyphs-ai/sdk";

/** Create a workflow-kind schedule. */
export const createWorkflowSchedule = (
  body: CreateWorkflowScheduleRequest,
): Promise<ScheduleView> =>
  mutateJson<ScheduleView>(`${workspacePrefix()}/schedules/workflow`, jsonInit("POST", body));

/**
 * List workflows launched by schedules, optionally filtered to one
 * schedule. The route contract (`workflows.scheduled.list`) responds
 * with `WorkflowHeader[]`, so the dashboard reads the typed shape
 * directly rather than re-narrowing an `unknown[]` at every call site.
 */
export const listScheduledWorkflows = async (opts: {
  scheduleId?: string;
}): Promise<WorkflowHeader[]> => {
  const query: { scheduleId?: string } = {};
  if (opts.scheduleId !== undefined) query.scheduleId = opts.scheduleId;
  return unwrap(
    await getApiWorkspacesByIdScheduledWorkflows({ path: { id: requireWorkspaceId() }, query }),
  );
};

export interface PreviewCronArgs {
  expr: string;
  tz: string;
  /** Number of upcoming fires to compute. Server bounds `[1, 100]`; defaults to 5. */
  n?: number;
}

/**
 * Unscoped cron preview. Calls the
 * `GET /api/workspaces/:workspaceId/schedules/preview-cron?expr=&tz=&n=`
 * route so the "New schedule" modal can show `describe` + next-N
 * fires while the user is still authoring an expression, with no
 * saved entity required.
 *
 * `unwrap` preserves the server's `error` string ("Invalid cron
 * expression: …" / "Unknown timezone: …") on the thrown `ApiError`, so
 * the modal can surface it inline.
 *
 * The optional `signal` parameter forwards an `AbortSignal` to the
 * underlying `fetch(...)` so callers (notably the debounced live
 * preview in `CreateScheduleModal`) can cancel an in-flight request
 * when a newer one supersedes it. Aborted requests reject with
 * `DOMException { name: "AbortError" }`; callers should filter that
 * shape out of their error UI.
 */
export const previewCron = async (
  args: PreviewCronArgs,
  signal?: AbortSignal,
): Promise<SchedulePreview> => {
  const query: { expr: string; tz: string; n?: string } = { expr: args.expr, tz: args.tz };
  if (args.n !== undefined) query.n = String(args.n);
  return unwrap(
    await getApiWorkspacesByIdSchedulesPreviewCron({
      path: { id: requireWorkspaceId() },
      query,
      ...(signal ? { signal } : {}),
    }),
  );
};
