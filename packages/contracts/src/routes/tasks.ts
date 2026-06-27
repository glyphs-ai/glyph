/**
 * Task routes (workspace-scoped) plus their request / response wire
 * shapes. Covers standalone dispatch, the schedule-origin list, the
 * per-task lifecycle surface (get / delete / cancel), and the
 * runtime-neutral activity timeline.
 */

import type { ActivityItem, TruncationInfo } from "@glyphs-ai/runtime";
import type { Task, TaskStatus } from "@glyphs-ai/task";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";
import type { WorkspacePathParams } from "./workspaces.js";

/**
 * GET /api/workspaces/:id/tasks query params (standalone-only route).
 * CSV `status` is parsed server-side.
 *
 * The route is standalone-only by construction — `origin` is hardcoded
 * at the handler layer; callers cannot widen the result set via a
 * query param. Schedule-launched tasks live at `/scheduled-tasks`
 * (see {@link ScheduledTaskListQuery}); workflow-launched tasks should
 * use their own origin-scoped route before being exposed here.
 */
export interface TaskListQuery {
  readonly agent?: string;
  readonly runtime?: string;
  readonly createdSince?: string;
  /** Comma-separated list of {@link TaskStatus}. */
  readonly status?: string;
}

/**
 * GET /api/workspaces/:id/scheduled-tasks query params (schedule-only route).
 * Same shape as {@link TaskListQuery} plus `scheduleId` for filtering
 * down to a single schedule's runs. CSV `status` is parsed server-side.
 *
 * The route is schedule-only by construction — `origin` is hardcoded
 * at the handler layer; callers cannot widen the result set via a
 * query param.
 */
export interface ScheduledTaskListQuery {
  readonly agent?: string;
  readonly runtime?: string;
  readonly createdSince?: string;
  /** Comma-separated list of {@link TaskStatus}. */
  readonly status?: string;
  /** Exact match on the launching schedule's id (the typed `origin_id` column). */
  readonly scheduleId?: string;
}

/** POST /api/workspaces/:id/tasks body. */
export interface DispatchTaskRequest {
  readonly agent: string;
  /**
   * Short, single-line task title. Required. Must be ≤ 200 chars
   * after trim and may not contain `\n` or `\r` (the displayed
   * label is single-line everywhere). The route layer rejects
   * violations with 400.
   */
  readonly brief: string;
  /**
   * Optional long-form task body. Multi-line allowed; rendered as
   * the markdown body of `<workdir>/TASK.md` under the `# <brief>`
   * header. Omit for a brief-only task.
   */
  readonly details?: string;
  readonly runtime?: string;
}

/** DELETE /api/workspaces/:id/tasks/:tid query params. */
export interface TaskDeleteQuery {
  readonly purge?: "1";
}

/**
 * GET /api/workspaces/:id/tasks/:tid/activity query params.
 * Pagination is server-controlled — the manifest declares the
 * shapes; the server route enforces the default limit (50) and
 * hard maximum (500) and rejects malformed integers with 400.
 *
 * `before` and `after` are mutually exclusive; the route returns
 * 400 if both are supplied. Omitting both returns the LATEST
 * `limit` items overall (tail), which is what GUI consumers want
 * on initial load.
 */
export interface TaskActivityQuery {
  /**
   * Backward pagination: return items with `seq < before`. Returns
   * the `limit` items immediately preceding the cut, ASC-sorted.
   * Used by GUI consumers loading older history when the user
   * scrolls up past the initial tail-window.
   */
  readonly before?: string;
  /**
   * Forward pagination: return items with `seq > after`. Used by
   * SSE polling and by callers walking head-to-tail.
   */
  readonly after?: string;
  /**
   * Maximum items to return. Server clamps to [1, 500]; default 50
   * when omitted. Sized for LLM token budgets when this endpoint
   * is reached via MCP.
   */
  readonly limit?: string;
}

/** Task-scoped path params. */
export interface TaskPathParams {
  readonly id: string;
  readonly tid: string;
}

export const taskRoutes = {
  "tasks.list": defineRoute<{ params: WorkspacePathParams; query: TaskListQuery }, readonly Task[]>(
    "GET",
    "/api/workspaces/:id/tasks",
  ),
  /**
   * Schedule-origin sibling of `tasks.list`. Same response shape
   * (`Task[]`) but the server constrains origin to
   * `'schedule'` server-side; callers cannot widen via the URL. Each
   * origin's caller surface gets a route whose URL IS the contract.
   * Per-task surfaces (get, cancel, activity) stay on
   * `/tasks/:tid` since task ids are globally unique.
   */
  "tasks.scheduled.list": defineRoute<
    { params: WorkspacePathParams; query: ScheduledTaskListQuery },
    readonly Task[]
  >("GET", "/api/workspaces/:id/scheduled-tasks"),
  "tasks.dispatch": defineRoute<{ params: WorkspacePathParams; body: DispatchTaskRequest }, Task>(
    "POST",
    "/api/workspaces/:id/tasks",
  ),
  "tasks.get": defineRoute<{ params: TaskPathParams }, Task>(
    "GET",
    "/api/workspaces/:id/tasks/:tid",
  ),
  "tasks.delete": defineRoute<{ params: TaskPathParams; query: TaskDeleteQuery }, void>(
    "DELETE",
    "/api/workspaces/:id/tasks/:tid",
  ),
  /**
   * Cancel a running task. POST is the verb because cancellation is
   * a state transition; DELETE is reserved for tasks.delete. The
   * route takes no request body.
   *
   * Status mappings:
   *   - 200 + Task — happy path; the response Task carries a
   *     {@link TaskCancellation}. The `cancellation.kind` enumerates as:
   *       - `'user'`   — the normal path: the manager killed a live
   *         subprocess at the operator's request. `message` is
   *         `'cancelled by user'`.
   *       - `'orphan'` — `cancel(id)` was called on a `running` row
   *         whose live entry has gone (an undetected orphan that
   *         `recoverOrphaned` missed). The row is reconciled to
   *         `cancelled` via the same terminal write so the dashboard
   *         renders symmetrically.
   *   - 404 — TaskNotFoundError (unknown id).
   *   - 409 — InvalidTransition; body is the structured envelope
   *     `{ error, code: 'InvalidTransition', status: <prev>,
   *     transition: 'cancel' }` so the dashboard can branch typed on
   *     `code`.
   *   - 503 — ManagerShuttingDownError (server is restarting). No
   *     `cancellation` is produced — the call refuses outright so the
   *     caller can retry once the manager is up.
   */
  "tasks.cancel": defineRoute<{ params: TaskPathParams }, Task>(
    "POST",
    "/api/workspaces/:id/tasks/:tid/cancel",
  ),
  /**
   * Runtime-neutral activity timeline: the runtime parses its own
   * event log into the {@link ActivityItem} discriminated union
   * declared in `@glyphs-ai/runtime` (end-to-end via
   * `Runtime.readActivity` — the route never sees a path or raw
   * bytes). Paginated by `before` / `after` / `limit`; `truncated`
   * marker is non-null when the runtime had to drop bytes/items to
   * stay within its safety cap. 404 NoEventsYet when the runtime
   * hasn't produced events yet (or doesn't implement the activity
   * surface).
   *
   * Clients derive `hasOlder` / `hasNewer` from the page window
   * (`activity[0].seq > 0` / `activity[last].seq < totalItems - 1`)
   * — items themselves are the cursor, no separate cursor field.
   */
  "tasks.activity.list": defineRoute<
    { params: TaskPathParams; query: TaskActivityQuery },
    {
      activity: readonly ActivityItem[];
      result: string | null;
      totalItems: number;
      truncated?: TruncationInfo;
    }
  >("GET", "/api/workspaces/:id/tasks/:tid/activity"),

  /**
   * SSE live-tail of activity. Subscribes to
   * `Runtime.streamActivity` and frames each
   * {@link ActivityItem} as `event: activity` with the JSON payload.
   * Sends `event: end` when the iterator completes (task terminal,
   * file gone, server shutdown). The client SHOULD use the
   * one-shot `tasks.activity.list` endpoint to fetch history first,
   * then subscribe here for the live tail with
   * `Last-Event-ID: <seq>` to dedup.
   *
   * Marked human-only — NOT exposed via MCP. LLM consumers should
   * use the paginated `tasks.activity.list` endpoint instead.
   */
  "tasks.activity.stream": defineRoute<{ params: TaskPathParams }, never>(
    "GET",
    "/api/workspaces/:id/tasks/:tid/activity/stream",
  ),

  /**
   * Serve a single artifact file produced by a terminal task. The
   * `:name` segment must appear (by basename) in the task's
   * `success.artifacts` array; anything else is 404. The route
   * additionally rejects names containing path separators or `..` as
   * a 400 defence-in-depth (the whitelist check is the actual
   * security boundary).
   *
   * Response is the file's bytes with a best-effort `Content-Type`
   * (text/* and well-known image types get the canonical mime;
   * everything else is `application/octet-stream`).
   *
   * Not exposed via MCP — agents already write the files; downloading
   * them back through HTTP would just round-trip bytes the agent
   * already has.
   */
  "tasks.artifacts.get": defineRoute<{ params: TaskPathParams & { name: string } }, never>(
    "GET",
    "/api/workspaces/:id/tasks/:tid/artifact/:name",
  ),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
