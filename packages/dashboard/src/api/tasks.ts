// Task REST client. All list / get / dispatch / delete / cancel calls use
// generated SDK operations. Types are sliced from the SDK response shapes so
// the dashboard stays in lockstep with the wire automatically. The SSE
// subscription (subscribeTaskActivity) and the artifact URL builder
// (taskArtifactUrl) keep raw browser primitives — EventSource has no SDK
// equivalent with the same reconnection semantics, and the artifact URL is
// a direct browser download (not a fetch call).

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
 * Subscribe to live activity for a running task. Returns a handle that can
 * be `close()`d to release the SSE connection. Each new {@link ActivityItem}
 * arriving on the wire is delivered to `onItem`; `onEnd` fires when the
 * runtime finishes streaming (task terminal) or the connection closes;
 * `onError` fires on transport / framing faults.
 *
 * Uses the browser's native `EventSource` rather than an SDK op: the SDK's
 * SSE model uses an async iterator / callback that would require rewriting
 * the reconnection semantics, for no type-safety gain on the JSON-parsed
 * frame payloads. `Last-Event-ID` reconnection is handled automatically by
 * the browser's EventSource using the `id:` field on each server frame.
 */
export interface ActivityStreamHandle {
  close(): void;
}

export interface SubscribeTaskActivityOpts {
  onItem: (item: ActivityItem) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export const subscribeTaskActivity = (
  taskId: string,
  opts: SubscribeTaskActivityOpts,
): ActivityStreamHandle => {
  const url = `${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}/activity/stream`;
  const es = new EventSource(url);
  es.addEventListener("activity", (ev) => {
    try {
      const item = JSON.parse((ev as MessageEvent).data) as ActivityItem;
      opts.onItem(item);
    } catch (err) {
      opts.onError?.(err as Error);
    }
  });
  es.addEventListener("end", () => {
    opts.onEnd?.();
    es.close();
  });
  es.addEventListener("error", () => {
    // EventSource's spec auto-reconnects; we surface the error for
    // visibility but don't tear down. CLOSED state means truly dead
    // (server returned 4xx, won't retry).
    if (es.readyState === EventSource.CLOSED) {
      opts.onError?.(new Error("SSE connection closed"));
    }
  });
  return {
    close: () => es.close(),
  };
};
