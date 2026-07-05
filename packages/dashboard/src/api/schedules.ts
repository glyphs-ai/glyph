// Schedules REST client. Mirrors the per-kind schedule routes the server
// exposes; every call goes through the generated SDK operations. List / get /
// preview / delete / run / create / patch all use the typed ops. The
// dashboard merges the two per-kind list endpoints and injects a `kind`
// discriminant into each target for local filtering / routing.

import type {
  GetApiWorkspacesByIdSchedulesPreviewCronResponse,
  GetApiWorkspacesByIdSchedulesTaskResponse,
  GetApiWorkspacesByIdSchedulesWorkflowResponse,
  PatchApiWorkspacesByIdSchedulesTaskBySidData,
  PatchApiWorkspacesByIdSchedulesWorkflowBySidData,
  PostApiWorkspacesByIdSchedulesTaskData,
  PostApiWorkspacesByIdSchedulesWorkflowData,
} from "@glyphs-ai/sdk";
import {
  deleteApiWorkspacesByIdSchedulesTaskBySid,
  deleteApiWorkspacesByIdSchedulesWorkflowBySid,
  getApiWorkspacesByIdScheduledWorkflows,
  getApiWorkspacesByIdSchedulesPreviewCron,
  getApiWorkspacesByIdSchedulesTask,
  getApiWorkspacesByIdSchedulesTaskBySid,
  getApiWorkspacesByIdSchedulesTaskBySidPreview,
  getApiWorkspacesByIdSchedulesWorkflow,
  getApiWorkspacesByIdSchedulesWorkflowBySid,
  getApiWorkspacesByIdSchedulesWorkflowBySidPreview,
  patchApiWorkspacesByIdSchedulesTaskBySid,
  patchApiWorkspacesByIdSchedulesWorkflowBySid,
  postApiWorkspacesByIdSchedulesTask,
  postApiWorkspacesByIdSchedulesTaskBySidRun,
  postApiWorkspacesByIdSchedulesWorkflow,
  postApiWorkspacesByIdSchedulesWorkflowBySidRun,
} from "@glyphs-ai/sdk";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";
import type { WorkflowHeader } from "./workflows.js";

// Internal raw row types from the per-kind list endpoints.
type RawTaskSchedule = GetApiWorkspacesByIdSchedulesTaskResponse[number];
type RawWorkflowSchedule = GetApiWorkspacesByIdSchedulesWorkflowResponse[number];

// Exported target types with `kind` added for dashboard-side discrimination.
export type TaskScheduleTarget = RawTaskSchedule["target"] & { readonly kind: "task" };
export type WorkflowScheduleTarget = RawWorkflowSchedule["target"] & { readonly kind: "workflow" };
export type ScheduleTarget = TaskScheduleTarget | WorkflowScheduleTarget;

export type TaskScheduleView = Omit<RawTaskSchedule, "target"> & { target: TaskScheduleTarget };
export type WorkflowScheduleView = Omit<RawWorkflowSchedule, "target"> & {
  target: WorkflowScheduleTarget;
};

/**
 * Wire-shape view of a schedule as the dashboard sees it. The server
 * exposes per-kind list endpoints (`/schedules/task`, `/schedules/workflow`);
 * the dashboard merges both and injects a `kind` discriminant into each
 * target for local filtering / routing.
 */
export type ScheduleView = TaskScheduleView | WorkflowScheduleView;

/**
 * Response shape for `GET /schedules/{kind}/{sid}` — the entity plus the
 * server-computed cronstrue description (`describe`).
 */
export type ScheduleDetail = ScheduleView & { describe: string };

// Request body types.
export type PatchTaskScheduleRequest = PatchApiWorkspacesByIdSchedulesTaskBySidData["body"];
export type PatchWorkflowScheduleRequest = PatchApiWorkspacesByIdSchedulesWorkflowBySidData["body"];
export type CreateTaskScheduleRequest = PostApiWorkspacesByIdSchedulesTaskData["body"];
export type CreateWorkflowScheduleRequest = PostApiWorkspacesByIdSchedulesWorkflowData["body"];
export type PreviewScheduleResult = GetApiWorkspacesByIdSchedulesPreviewCronResponse;

// Legacy alias kept so call sites that use `PatchScheduleRequest` do not need changes.
export type PatchScheduleRequest = PatchTaskScheduleRequest;
// Legacy alias for the task-kind create body.
export type CreateScheduleRequest = CreateTaskScheduleRequest;

/** Response shape for `GET /schedules/{kind}/{sid}/preview?n=N`. */
export type SchedulePreview = PreviewScheduleResult;

export interface ListSchedulesOpts {
  /** Filter by target agent FQN (e.g. `"official/engineer"`). */
  agent?: string;
  /** Filter by enabled state. */
  enabled?: boolean;
}

// Helpers to inject the kind discriminant into raw API responses.
function addTaskKind(raw: RawTaskSchedule): TaskScheduleView {
  return { ...raw, target: { kind: "task" as const, ...raw.target } };
}
function addWorkflowKind(raw: RawWorkflowSchedule): WorkflowScheduleView {
  return { ...raw, target: { kind: "workflow" as const, ...raw.target } };
}

export const listSchedules = async (opts: ListSchedulesOpts = {}): Promise<ScheduleView[]> => {
  const id = requireWorkspaceId();
  const enabledParam =
    opts.enabled !== undefined
      ? ((opts.enabled ? "true" : "false") as "true" | "false")
      : undefined;
  const [taskResult, wfResult] = await Promise.all([
    getApiWorkspacesByIdSchedulesTask({
      path: { id },
      query: { agent: opts.agent, enabled: enabledParam },
    }),
    getApiWorkspacesByIdSchedulesWorkflow({
      path: { id },
      query: { coordinatorAgent: opts.agent, enabled: enabledParam },
    }),
  ]);
  return [...unwrap(taskResult).map(addTaskKind), ...unwrap(wfResult).map(addWorkflowKind)];
};

export const getSchedule = async (
  scheduleId: string,
  kind?: "task" | "workflow",
): Promise<ScheduleDetail> => {
  const id = requireWorkspaceId();
  if (kind === "workflow") {
    const result = await getApiWorkspacesByIdSchedulesWorkflowBySid({
      path: { id, sid: scheduleId },
    });
    const raw = unwrap(result) as RawWorkflowSchedule & { describe: string };
    return addWorkflowKind(raw) as ScheduleDetail;
  }
  const result = await getApiWorkspacesByIdSchedulesTaskBySid({
    path: { id, sid: scheduleId },
  });
  const raw = unwrap(result) as RawTaskSchedule & { describe: string };
  return addTaskKind(raw) as ScheduleDetail;
};

export interface PreviewScheduleOpts {
  /** Number of upcoming fire times to compute. Server clamps to `[1, 100]` and defaults to 3. */
  n?: number;
}

export const previewSchedule = async (
  scheduleId: string,
  opts: PreviewScheduleOpts = {},
  kind?: "task" | "workflow",
): Promise<SchedulePreview> => {
  const id = requireWorkspaceId();
  const query: { n?: number } = {};
  if (opts.n !== undefined) query.n = opts.n;
  if (kind === "workflow") {
    return unwrap(
      await getApiWorkspacesByIdSchedulesWorkflowBySidPreview({
        path: { id, sid: scheduleId },
        query,
      }),
    );
  }
  return unwrap(
    await getApiWorkspacesByIdSchedulesTaskBySidPreview({
      path: { id, sid: scheduleId },
      query,
    }),
  );
};

export const patchSchedule = async (
  scheduleId: string,
  body: PatchTaskScheduleRequest,
): Promise<ScheduleView> => {
  const raw = unwrap(
    await patchApiWorkspacesByIdSchedulesTaskBySid({
      path: { id: requireWorkspaceId(), sid: scheduleId },
      body,
    }),
  );
  return addTaskKind(raw);
};

export const patchWorkflowSchedule = async (
  scheduleId: string,
  body: PatchWorkflowScheduleRequest,
): Promise<ScheduleView> => {
  const raw = unwrap(
    await patchApiWorkspacesByIdSchedulesWorkflowBySid({
      path: { id: requireWorkspaceId(), sid: scheduleId },
      body,
    }),
  );
  return addWorkflowKind(raw);
};

export const deleteSchedule = async (
  scheduleId: string,
  kind: "task" | "workflow",
): Promise<{ deletedDispatchCount: number }> => {
  const id = requireWorkspaceId();
  if (kind === "workflow") {
    return unwrap(
      await deleteApiWorkspacesByIdSchedulesWorkflowBySid({
        path: { id, sid: scheduleId },
      }),
    );
  }
  return unwrap(
    await deleteApiWorkspacesByIdSchedulesTaskBySid({
      path: { id, sid: scheduleId },
    }),
  );
};

export const runSchedule = async (
  scheduleId: string,
  kind: "task" | "workflow",
): Promise<{ dispatchId: string }> => {
  const id = requireWorkspaceId();
  if (kind === "workflow") {
    return unwrap(
      await postApiWorkspacesByIdSchedulesWorkflowBySidRun({
        path: { id, sid: scheduleId },
      }),
    );
  }
  return unwrap(
    await postApiWorkspacesByIdSchedulesTaskBySidRun({
      path: { id, sid: scheduleId },
    }),
  );
};

/** Create a task-kind schedule. */
export const createSchedule = async (body: CreateTaskScheduleRequest): Promise<ScheduleView> => {
  const raw = unwrap(
    await postApiWorkspacesByIdSchedulesTask({ path: { id: requireWorkspaceId() }, body }),
  );
  return addTaskKind(raw);
};

/** Create a workflow-kind schedule. */
export const createWorkflowSchedule = async (
  body: CreateWorkflowScheduleRequest,
): Promise<ScheduleView> => {
  const raw = unwrap(
    await postApiWorkspacesByIdSchedulesWorkflow({ path: { id: requireWorkspaceId() }, body }),
  );
  return addWorkflowKind(raw);
};

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
  const query: { expr: string; tz: string; n?: number } = { expr: args.expr, tz: args.tz };
  if (args.n !== undefined) query.n = args.n;
  return unwrap(
    await getApiWorkspacesByIdSchedulesPreviewCron({
      path: { id: requireWorkspaceId() },
      query,
      ...(signal ? { signal } : {}),
    }),
  );
};
