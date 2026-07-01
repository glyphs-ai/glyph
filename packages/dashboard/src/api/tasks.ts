// A Task is an autonomous one-shot agent invocation: dispatch a brief +
// optional details, the runtime spawns the agent, and the dashboard polls
// for terminal status. Each runtime publishes its own native event log; the
// server exposes the parsed timeline at `/api/.../tasks/:taskId/activity` as
// runtime-neutral `ActivityItem[]`. Filename, format, and on-disk layout of
// the underlying log stay inside the runtime adapter; the dashboard never
// sees them.

import { extractError, fetchJson, jsonInit, mutate, mutateJson, workspacePrefix } from "./http.js";

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled";

/**
 * Who launched this task. String union to match
 * `@glyphs-ai/task` `TaskOrigin`. The union is a **data-shape contract**:
 * any `Task` record returned from any endpoint (`/tasks/:id`,
 * `/scheduled-tasks`, etc.) can carry any of these values on its
 * `origin` field. Route-level filtering is enforced by the URL the
 * client hits, not by an opt-in query filter — `/tasks` lists
 * standalone-only; `/scheduled-tasks` lists schedule-only; workflow-
 * launched tasks use their own dedicated surface.
 */
export type TaskOrigin = "standalone" | "workflow" | "schedule";

/**
 * Why a task ended in `failed`. Discriminated by `kind`.
 * Mirrors `@glyphs-ai/task` `TaskFailure` exactly. The dashboard is a
 * browser bundle so this is duplicated, not imported; keep in lockstep
 * with the entity definition when it changes.
 *
 *   - exited   → subprocess exited non-zero (carries `exit_code`)
 *   - signal   → terminated by OS signal (carries `signal`)
 *   - shutdown → task-module shutdown killed it
 *   - orphan   → recoverOrphaned marked a row whose owner crashed
 *   - internal → kernel-side fault
 *
 * Exit code / signal live exclusively inside the typed `failure`
 * payload.
 */
export type TaskFailure =
  | { kind: "exited"; exit_code: number; message: string }
  | { kind: "signal"; signal: string; message: string }
  | { kind: "shutdown"; message: string }
  | { kind: "orphan"; message: string }
  | { kind: "internal"; message: string };

/**
 * Why a task ended in `cancelled`.
 *
 *   - user    → cancelTask (operator request)
 *   - cascade -> reconciliation / parent-side cancellation, including
 *               rows orphaned by parent shutdown
 */
export type TaskCancellation =
  | { kind: "user"; message: string }
  | { kind: "cascade"; message: string };

export interface TaskSuccess {
  /**
   * Head of the agent's last assistant utterance, capped server-side.
   * `null` when the agent finished without producing an assistant
   * turn or the runtime had no agent activity to report.
   */
  output: string | null;
  artifacts?: readonly string[];
}

export interface TaskRecord {
  id: string;
  agent: string;
  /** Short single-line task title (≤ 200 chars). Always present. */
  brief: string;
  /** Optional long-form task body. Multi-line allowed. Omitted when not provided. */
  details?: string;
  /** Who launched this task. */
  origin: TaskOrigin;
  /**
   * Typed routing id for the originating integration (e.g. the schedule
   * id when `origin === "schedule"`, or the workflow node id when
   * `origin === "workflow"`). Projected from the `origin_id` column;
   * absent for `standalone` tasks.
   */
  originId?: string;
  status: TaskStatus;
  /**
   * Open-shape metadata. Includes runtime bookkeeping fields like
   * `workdir`, `runtime`, `runtimeSessionId`. Exit details are read
   * from `failure.exit_code` / `failure.signal`, not mirrored here.
   */
  metadata: Record<string, unknown>;
  /** ISO 8601 string. */
  createdAt: string;
  /** ISO 8601 string; non-null because it is set at create time. */
  startedAt: string;
  endedAt?: string;
  /** Populated iff status='succeeded'. */
  success?: TaskSuccess;
  /** Populated iff status='failed'. */
  failure?: TaskFailure;
  /** Populated iff status='cancelled'. */
  cancellation?: TaskCancellation;
}

/**
 * Optional server-side filters for `listTasks`. Mirrors the server's
 * `TaskListQuery`. Omitted fields are not sent on the wire and the
 * server returns the matching set.
 *
 * `origin` and `scheduleId` are not accepted on `/tasks` (the route is
 * standalone-only by construction). Schedule-launched runs live at
 * `/scheduled-tasks`; use {@link listScheduledTasks} (and
 * {@link ListScheduledTasksOpts}) for those.
 */
export interface ListTasksOpts {
  agent?: string;
  runtime?: string;
  /** ISO 8601 (the server canonicalises). */
  createdSince?: string;
  /** Statuses to include. The server joins with `,` for the query. */
  statuses?: TaskStatus[];
}

export const listTasks = (opts: ListTasksOpts = {}): Promise<TaskRecord[]> => {
  const qs = new URLSearchParams();
  if (opts.agent) qs.set("agent", opts.agent);
  if (opts.runtime) qs.set("runtime", opts.runtime);
  if (opts.createdSince) qs.set("createdSince", opts.createdSince);
  if (opts.statuses && opts.statuses.length > 0) qs.set("status", opts.statuses.join(","));
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<TaskRecord[]>(`${workspacePrefix()}/tasks${suffix}`, "tasks");
};

/**
 * Optional server-side filters for {@link listScheduledTasks}. Mirrors
 * the server's `ScheduledTaskListQuery`. Same shape as
 * {@link ListTasksOpts} plus `scheduleId` for narrowing down to a
 * single schedule's runs.
 */
export interface ListScheduledTasksOpts {
  agent?: string;
  runtime?: string;
  /** ISO 8601 (the server canonicalises). */
  createdSince?: string;
  /** Statuses to include. The server joins with `,` for the query. */
  statuses?: TaskStatus[];
  /** Exact match on the schedule's `origin_id` (wire param `scheduleId`). */
  scheduleId?: string;
}

/**
 * List schedule-launched tasks in the current workspace. The route's
 * URL pins `origin = 'schedule'` server-side; callers cannot widen
 * the result set. Use {@link listTasks} for standalone tasks; each
 * origin's caller surface gets a route whose URL is the contract.
 */
export const listScheduledTasks = (opts: ListScheduledTasksOpts = {}): Promise<TaskRecord[]> => {
  const qs = new URLSearchParams();
  if (opts.agent) qs.set("agent", opts.agent);
  if (opts.runtime) qs.set("runtime", opts.runtime);
  if (opts.createdSince) qs.set("createdSince", opts.createdSince);
  if (opts.statuses && opts.statuses.length > 0) qs.set("status", opts.statuses.join(","));
  if (opts.scheduleId) qs.set("scheduleId", opts.scheduleId);
  const suffix = qs.toString() === "" ? "" : `?${qs.toString()}`;
  return fetchJson<TaskRecord[]>(
    `${workspacePrefix()}/scheduled-tasks${suffix}`,
    "scheduled tasks",
  );
};

export const getTask = (taskId: string): Promise<TaskRecord> =>
  fetchJson<TaskRecord>(`${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}`, "task");

/**
 * Build the URL the browser should hit to download a task artifact by
 * name. : artifacts are served from the workspace-scoped
 * task route, gated by a whitelist on `success.artifacts`.
 */
export const taskArtifactUrl = (taskId: string, name: string): string =>
  `${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(name)}`;

export interface DispatchTaskOpts {
  agent: string;
  brief: string;
  details?: string;
  runtime?: string;
}

export const dispatchTask = async (opts: DispatchTaskOpts): Promise<TaskRecord> => {
  const { agent, brief, details, runtime } = opts;
  const body: Record<string, string> = { agent, brief };
  if (details !== undefined && details !== "") body.details = details;
  if (runtime !== undefined) body.runtime = runtime;
  return mutateJson<TaskRecord>(`${workspacePrefix()}/tasks`, jsonInit("POST", body));
};

export const deleteTask = (taskId: string, opts?: { purge?: boolean }) => {
  // Default ("archive") removes only the task metadata row — workdir
  // contents (stderr.log, agent artifacts) stay on disk so the user
  // can inspect the run after the fact; the runtime's own per-task
  // state (Copilot's events.jsonl / session-state dir) is also
  // preserved. `{ purge: true }` is the hard-delete path: row +
  // workdir + runtime state all go, in that order — runtime first
  // so a runtime failure aborts before any local removal (mirrors
  // session-delete semantics).
  //
  // Server returns 409 when the task is still running (mutate()
  // throws the typed envelope; callers parse `code` + `transition`
  // to render the "cancel first" CTA).
  const qs = opts?.purge ? "?purge=1" : "";
  return mutate(`${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}${qs}`, {
    method: "DELETE",
  });
};

/**
 * Cancel a running task. POSTs to
 * `/tasks/:id/cancel`; awaits the server's response (which itself
 * awaits `live.settled`), so the returned `TaskRecord` already has
 * status='cancelled' and the `cancellation` field populated.
 *
 * Throws on:
 *   - 404 → task gone (caller should drop the row from optimistic state)
 *   - 409 → task already terminal (caller should refresh + render
 *     whatever it became — the server includes the structured envelope
 *     `{ code: 'InvalidTransition', status, transition: 'cancel' }`
 *     so the UI can branch typed)
 *   - 503 → server is shutting down (one-shot toast + retry once the
 *     restart finishes)
 */
export const cancelTask = (taskId: string): Promise<TaskRecord> => {
  return mutateJson<TaskRecord>(`${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
};

/**
 * Runtime-neutral activity timeline for a task. The runtime parses
 * its own event log into the {@link ActivityItem} discriminated
 * union below; the dashboard renders them without knowing which
 * runtime produced the underlying log.
 *
 * The shapes here MIRROR `@glyphs-ai/runtime`'s exports — they are
 * NOT imported because dashboard is a browser bundle that doesn't
 * pull from server-side packages. Keep them in lock-step manually
 * (runtime-internal types like `Runtime` are excluded).
 *
 * Returns `null` (404 NoEventsYet) when the runtime doesn't implement
 * structured activity or when the log isn't on disk yet.
 */

export interface TokenUsage {
  input?: number;
  output: number;
  cached?: number;
  cacheWrite?: number;
  reasoning?: number;
  total?: number;
}

export interface SummaryStats {
  filesModified?: string[];
  linesAdded?: number;
  linesRemoved?: number;
  toolCallsCount?: number;
  durationMs?: number;
  costUSD?: number;
  model?: string;
  premiumRequests?: number;
}

export interface Attachment {
  kind: "image" | "file";
  mimeType?: string;
  url?: string;
  data?: string;
  name?: string;
}

interface BaseActivityItem {
  seq: number;
  id?: string;
  parentSeq?: number;
  timestamp: string;
}

export interface UserActivityItem extends BaseActivityItem {
  kind: "user";
  text: string;
  attachments?: Attachment[];
}

export interface AssistantActivityItem extends BaseActivityItem {
  kind: "assistant";
  text: string;
  model?: string;
  tokens?: TokenUsage;
  stopReason?: string;
}

export interface ThinkingActivityItem extends BaseActivityItem {
  kind: "thinking";
  text: string;
  subject?: string;
}

export interface ToolCallActivityItem extends BaseActivityItem {
  kind: "tool_call";
  callId: string;
  name: string;
  args?: unknown;
  status: "running" | "success" | "error" | "cancelled";
  result?: unknown;
  display?: { content: string; markdown?: boolean };
  durationMs?: number;
}

export interface SystemActivityItem extends BaseActivityItem {
  kind: "system";
  text: string;
  level?: "info" | "warn" | "error";
  subKind?: string;
}

export interface SummaryActivityItem extends BaseActivityItem {
  kind: "summary";
  text?: string;
  tokens?: TokenUsage;
  stats?: SummaryStats;
}

export type ActivityItem =
  | UserActivityItem
  | AssistantActivityItem
  | ThinkingActivityItem
  | ToolCallActivityItem
  | SystemActivityItem
  | SummaryActivityItem;

export interface TruncationInfo {
  reason: "size_limit" | "page_limit";
  droppedBytes?: number;
  droppedItems?: number;
  hint?: string;
}

export interface TaskActivity {
  activity: ActivityItem[];
  result: string | null;
  totalItems: number;
  truncated?: TruncationInfo;
}

export interface FetchTaskActivityOpts {
  /**
   * Backward pagination: returns items with `seq < before`. Mutually
   * exclusive with `after`; both → 400 from the server.
   */
  before?: number;
  /**
   * Forward pagination: returns items with `seq > after`. Used by
   * polling and by callers walking head-to-tail.
   */
  after?: number;
  limit?: number;
}

export const fetchTaskActivity = async (
  taskId: string,
  opts: FetchTaskActivityOpts = {},
): Promise<TaskActivity | null> => {
  const usp = new URLSearchParams();
  if (opts.before !== undefined) usp.append("before", String(opts.before));
  if (opts.after !== undefined) usp.append("after", String(opts.after));
  if (opts.limit !== undefined) usp.append("limit", String(opts.limit));
  const qs = usp.toString();
  const url = `${workspacePrefix()}/tasks/${encodeURIComponent(taskId)}/activity${qs ? `?${qs}` : ""}`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await extractError(r));
  return r.json();
};

/**
 * Subscribe to live activity for a running task. Returns a handle
 * that can be `close()`d to release the SSE connection. Each new
 * {@link ActivityItem} arriving on the wire is delivered to
 * `onItem`; `onEnd` fires when the runtime finishes streaming
 * (task terminal) or the connection closes; `onError` fires on
 * transport / framing faults (the SSE layer auto-reconnects on
 * its own — `onError` is just for visibility).
 *
 * The `Last-Event-ID` reconnection header is set by the browser's
 * native EventSource using the `id:` field on each frame the
 * server emits — no manual bookkeeping required.
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
