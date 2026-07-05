// Task REST client. All list / get / dispatch / delete / cancel calls use
// generated SDK operations. Types are sliced from the SDK response shapes so
// the dashboard stays in lockstep with the wire automatically. The live
// activity stream (openActivityStream) is an SDK-backed SSE consumer wrapped
// for reconnection by the `useReconnectingStream` hook; the artifact URL
// builder (taskArtifactUrl) keeps a raw browser URL (a direct download, not a
// fetch call).

import type {
  GetApiWorkspacesByIdScheduledTasksData,
  GetApiWorkspacesByIdTasksByOriginResponse,
  GetApiWorkspacesByIdTasksByTidActivityResponse,
  GetApiWorkspacesByIdTasksByTidResponse,
  GetApiWorkspacesByIdTasksData,
  PostApiWorkspacesByIdTasksData,
} from "@glyphs-ai/sdk";
import {
  deleteApiWorkspacesByIdTasksByTid,
  getApiWorkspacesByIdScheduledTasks,
  getApiWorkspacesByIdTasks,
  getApiWorkspacesByIdTasksByOrigin,
  getApiWorkspacesByIdTasksByTid,
  getApiWorkspacesByIdTasksByTidActivity,
  getApiWorkspacesByIdTasksByTidActivityStream,
  postApiWorkspacesByIdTasks,
  postApiWorkspacesByIdTasksByTidCancel,
} from "@glyphs-ai/sdk";
import { workspacePrefix } from "./http.js";
import { requireWorkspaceId, unwrap } from "./sdk-client.js";

// ── SDK-derived entity types ─────────────────────────────────────────
// GetApiWorkspacesByIdTasksByTidResponse is `{ ...task } | null` (the server
// returns null on 200 for the nullable-lookup route). NonNullable extracts
// the task shape used everywhere.
export type TaskRecord = NonNullable<GetApiWorkspacesByIdTasksByTidResponse>;
export type TaskStatus = TaskRecord["status"];
export type TaskOrigin = TaskRecord["origin"];
export type TaskFailure = NonNullable<TaskRecord["failure"]>;
export type TaskCancellation = NonNullable<TaskRecord["cancellation"]>;
export type TaskSuccess = NonNullable<TaskRecord["success"]>;

// ── Activity types ────────────────────────────────────────────────────
export type TaskActivity = GetApiWorkspacesByIdTasksByTidActivityResponse;
export type ActivityItem = TaskActivity["activity"][number];
/** Discriminated-union variants, useful in strongly-typed factories. */
export type ToolCallActivityItem = Extract<ActivityItem, { kind: "tool_call" }>;
export type UserActivityItem = Extract<ActivityItem, { kind: "user" }>;

// ── Request option types ──────────────────────────────────────────────
// Derived from the SDK query / body shapes so they stay in sync with the wire.

export type ListTasksOpts = NonNullable<GetApiWorkspacesByIdTasksData["query"]>;
export type ListScheduledTasksOpts = NonNullable<GetApiWorkspacesByIdScheduledTasksData["query"]>;
export type DispatchTaskOpts = PostApiWorkspacesByIdTasksData["body"];

export interface FetchTaskActivityOpts {
  /** Returns items with `seq < before`. Mutually exclusive with `after`. */
  before?: number;
  /** Returns items with `seq > after`. Used for polling and head-to-tail walks. */
  after?: number;
  limit?: number;
}

// ── List / get ────────────────────────────────────────────────────────

export const listTasks = async (opts: ListTasksOpts = {}): Promise<TaskRecord[]> =>
  unwrap(
    await getApiWorkspacesByIdTasks({
      path: { id: requireWorkspaceId() },
      query: opts,
    }),
  );

/**
 * List schedule-launched tasks in the current workspace. The route URL pins
 * `origin = 'schedule'` server-side. Use {@link listTasks} for standalone
 * tasks.
 */
export const listScheduledTasks = async (
  opts: ListScheduledTasksOpts = {},
): Promise<TaskRecord[]> =>
  unwrap(
    await getApiWorkspacesByIdScheduledTasks({
      path: { id: requireWorkspaceId() },
      query: opts,
    }),
  );

export const getTask = async (taskId: string): Promise<TaskRecord> => {
  const result = unwrap(
    await getApiWorkspacesByIdTasksByTid({
      path: { id: requireWorkspaceId(), tid: taskId },
    }),
  );
  if (result === null) throw new Error("task not found");
  return result;
};

/**
 * Resolve the latest task for an `(origin, originId)` pair, or `null` when
 * none has been dispatched yet. The `(origin, originId)` linkage is owned by
 * the task read-model; callers navigating from one of their own entities
 * (e.g. a workflow worker node → its underlying task) pass their entity id as
 * `originId`. The workflow surface never exposes a task id — the node id is
 * resolved to a task here, through the task surface.
 */
export const findTaskByOrigin = async (
  origin: string,
  originId: string,
): Promise<GetApiWorkspacesByIdTasksByOriginResponse> =>
  unwrap(
    await getApiWorkspacesByIdTasksByOrigin({
      path: { id: requireWorkspaceId() },
      query: { origin, originId },
    }),
  );

/**
 * Build the URL the browser should hit to download a task artifact by its
 * relative-path identity. Artifacts are served from the workspace-scoped
 * task route, gated by a whitelist on `success.artifacts`.
 */
export const taskArtifactUrl = (taskId: string, relPath: string): string =>
  `${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}/artifact?path=${encodeURIComponent(relPath)}`;

export const dispatchTask = async (opts: DispatchTaskOpts): Promise<TaskRecord> =>
  unwrap(
    await postApiWorkspacesByIdTasks({
      path: { id: requireWorkspaceId() },
      body: opts,
    }),
  );

export const deleteTask = async (taskId: string, opts?: { purge?: boolean }): Promise<void> => {
  // Default ("archive") removes only the task metadata row — workdir contents
  // (stderr.log, agent artifacts) stay on disk. `{ purge: true }` is the
  // hard-delete path: row + workdir + runtime state all go, runtime first so
  // a runtime failure aborts before any local removal.
  //
  // Server returns 409 when the task is still running; the typed envelope
  // `{ code: "InvalidTransition" }` lets callers render the "cancel first" CTA.
  unwrap(
    await deleteApiWorkspacesByIdTasksByTid({
      path: { id: requireWorkspaceId(), tid: taskId },
      query: opts?.purge ? { purge: "1" } : undefined,
    }),
  );
};

/**
 * Cancel a running task. POSTs to `/tasks/:id/cancel`; the returned
 * `TaskRecord` already has `status='cancelled'` and `cancellation` populated.
 *
 * Throws on:
 *   - 404 → task gone (caller should drop the row from optimistic state)
 *   - 409 → task already terminal (`{ code: 'InvalidTransition' }` envelope)
 *   - 503 → server is shutting down
 */
export const cancelTask = async (taskId: string): Promise<TaskRecord> =>
  unwrap(
    await postApiWorkspacesByIdTasksByTidCancel({
      path: { id: requireWorkspaceId(), tid: taskId },
    }),
  );

/**
 * Runtime-neutral activity timeline for a task. Returns `null` (404
 * NoEventsYet) when the runtime doesn't implement structured activity or when
 * the log isn't on disk yet.
 */
export const fetchTaskActivity = async (
  taskId: string,
  opts: FetchTaskActivityOpts = {},
): Promise<TaskActivity | null> => {
  const result = await getApiWorkspacesByIdTasksByTidActivity({
    path: { id: requireWorkspaceId(), tid: taskId },
    query: {
      before: opts.before,
      after: opts.after,
      limit: opts.limit,
    },
  });
  if (result.response?.status === 404) return null;
  return unwrap(result);
};

/**
 * Callbacks for a single activity-stream connection. `onItem` receives each
 * {@link ActivityItem} as it arrives; `onEnd` fires when the server sends the
 * `end` sentinel (task terminal); `onError` fires on a per-frame `error`
 * payload or a transport fault.
 */
export interface ActivityStreamCallbacks {
  onItem: (item: ActivityItem) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface OpenActivityStreamOpts {
  /** Aborting this signal closes the connection. */
  signal: AbortSignal;
  /** Seq to resume after — sent as `Last-Event-ID` so the server replays forward. */
  lastEventId?: string;
}

export interface ActivityStreamOutcome {
  /** Highest `id:` (seq) seen — the resume point for the next reconnect. */
  lastEventId: string | undefined;
  /** True once the server sent the `end` sentinel (terminal; do not reconnect). */
  ended: boolean;
}

function streamErrorMessage(data: unknown): string {
  if (
    data !== null &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  ) {
    return (data as { error: string }).error;
  }
  return "activity stream error";
}

/**
 * Open ONE SSE connection to a task's activity stream over the typed SDK
 * operation and drive it to completion. Resolves when the server sends the
 * `end` sentinel, the connection closes, or `signal` aborts. The SDK stream is
 * one-shot (`sseMaxRetryAttempts: 1`) — reconnection is the caller's policy
 * (see the `useReconnectingStream` hook). Per-frame routing keys on the SSE
 * `event:` name (`activity` | `heartbeat` | `end` | `error`); `heartbeat`
 * frames are liveness only.
 */
export const openActivityStream = async (
  taskId: string,
  cbs: ActivityStreamCallbacks,
  opts: OpenActivityStreamOpts,
): Promise<ActivityStreamOutcome> => {
  let lastEventId = opts.lastEventId;
  let ended = false;
  const { stream } = await getApiWorkspacesByIdTasksByTidActivityStream({
    path: { id: requireWorkspaceId(), tid: taskId },
    signal: opts.signal,
    sseMaxRetryAttempts: 1,
    ...(opts.lastEventId !== undefined ? { headers: { "Last-Event-ID": opts.lastEventId } } : {}),
    onSseEvent: (ev) => {
      if (ev.id !== undefined) lastEventId = ev.id;
      switch (ev.event) {
        case "activity":
          cbs.onItem(ev.data as ActivityItem);
          break;
        case "end":
          ended = true;
          cbs.onEnd?.();
          break;
        case "error":
          cbs.onError?.(new Error(streamErrorMessage(ev.data)));
          break;
        // "heartbeat": liveness only.
      }
    },
    onSseError: (err) => {
      cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });
  // Iterating drives the generator; all routing happens in `onSseEvent`.
  for await (const _frame of stream) {
    if (opts.signal.aborted) break;
  }
  return { lastEventId, ended };
};
