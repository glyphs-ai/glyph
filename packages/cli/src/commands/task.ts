/**
 * `glyph task …` — 6 subcommands wrapping the workspace-scoped tasks
 * HTTP surface (list / dispatch / show / rm / cancel / activity).
 *
 * `activity` returns the runtime-parsed `ActivityItem[]` timeline as
 * JSON — runtime-neutral.
 */

import {
  deleteApiWorkspacesByIdTasksByTid,
  type GetApiWorkspacesByIdTasksData,
  getApiWorkspacesByIdTasks,
  getApiWorkspacesByIdTasksByTid,
  getApiWorkspacesByIdTasksByTidActivity,
  getApiWorkspacesByIdTasksByTidActivityStream,
  postApiWorkspacesByIdTasks,
  postApiWorkspacesByIdTasksByTidCancel,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../connect.js";
import {
  formatError,
  formatJson,
  formatRecord,
  formatTable,
  isInvalidTransition,
  isStatusError,
  pickFormat,
} from "../output.js";
import type { WorkspaceFlagOpts } from "../registrars/_shared.js";
import type { CommandResult } from "../result.js";
import { unwrap } from "../sdk-client.js";

// ─── list ──────────────────────────────────────────────────────────────
export interface TaskListOpts extends WorkspaceFlagOpts {
  readonly agent?: string;
  readonly runtime?: string;
  readonly createdSince?: string;
  /** One of the TaskStatus values (running, succeeded, failed, cancelled). */
  readonly status?: string;
  /**
   * Origin kind to scope the listing to (`workflow`, `schedule`). Replaces the
   * default standalone scoping. Must be paired with `originId`.
   */
  readonly origin?: string;
  /** Origin id within `origin` (nodeId for `workflow`, scheduleId for `schedule`). */
  readonly originId?: string;
}

/**
 * `glyph task list` — lists standalone tasks for the workspace by default,
 * or every task for a given origin pair when `--origin`/`--origin-id` are
 * supplied (e.g. `--origin workflow --origin-id <nodeId>` enumerates a
 * workflow node's tasks across all statuses, newest first — the reverse
 * lookup a coordinator uses to find a node's dispatched task).
 *
 * The dedicated `glyph schedule` surface (backed by `/scheduled-tasks`)
 * stays the ergonomic way to browse a schedule's runs; `--origin schedule
 * --origin-id <scheduleId>` reaches the same rows through this generic path.
 */
export async function taskList(opts: TaskListOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: NonNullable<GetApiWorkspacesByIdTasksData["query"]> = {};
    if (opts.agent !== undefined) query.agent = opts.agent;
    if (opts.runtime !== undefined) query.runtime = opts.runtime;
    if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
    // `opts.status` is a raw CLI string; the server validates it against the
    // TaskStatus enum and returns a 400 (surfaced as-is) for a bad value.
    if (opts.status !== undefined) {
      query.status = opts.status as NonNullable<
        NonNullable<GetApiWorkspacesByIdTasksData["query"]>["status"]
      >;
    }
    // Origin scoping. `opts.origin` is a raw CLI string; the server validates
    // it against the `origin` enum and returns a 400 ValidationError (surfaced
    // as-is) for an unknown or non-scopable kind (e.g. `standalone`). The
    // registrar guarantees both or neither.
    if (opts.origin !== undefined) {
      query.origin = opts.origin as NonNullable<
        NonNullable<GetApiWorkspacesByIdTasksData["query"]>["origin"]
      >;
    }
    if (opts.originId !== undefined) query.originId = opts.originId;
    const list = unwrap(
      await getApiWorkspacesByIdTasks({
        path: { id: workspaceId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    const table = formatTable(
      ["id", "agent", "status", "origin", "createdAt"],
      list.map((t) => [
        (t as { id?: string }).id ?? "",
        (t as { agent?: string }).agent ?? "",
        (t as { status?: string }).status ?? "",
        (t as { origin?: string }).origin ?? "",
        (t as { createdAt?: string }).createdAt ?? "",
      ]),
    );
    // When an origin filter is active, prefix the table with the scope so the
    // human reader knows these are not standalone tasks.
    const stdout =
      opts.origin !== undefined && opts.originId !== undefined
        ? `origin: ${opts.origin}:${opts.originId}\n${table}`
        : table;
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── dispatch ──────────────────────────────────────────────────────────
export interface TaskDispatchOpts extends WorkspaceFlagOpts {
  readonly agent: string;
  /** Short, single-line task title (≤ 200 chars). Required. */
  readonly brief: string;
  /** Optional long-form task body. Multi-line allowed. */
  readonly details?: string;
  readonly runtime?: string;
}

export async function taskDispatch(opts: TaskDispatchOpts): Promise<CommandResult> {
  if (typeof opts.agent !== "string" || opts.agent.trim() === "") {
    return { exitCode: 2, stderr: "missing required --agent <name>\n" };
  }
  if (typeof opts.brief !== "string" || opts.brief.trim() === "") {
    return { exitCode: 2, stderr: "missing required --brief <text>\n" };
  }
  if (opts.brief.includes("\n") || opts.brief.includes("\r")) {
    return {
      exitCode: 2,
      stderr:
        "--brief must be a single line (no newline characters); pass long content via --details\n",
    };
  }
  if (opts.brief.trim().length > 200) {
    return { exitCode: 2, stderr: "--brief must be 200 characters or fewer\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const body: { agent: string; brief: string; details?: string; runtime?: string } = {
      agent: opts.agent,
      brief: opts.brief.trim(),
    };
    if (opts.details !== undefined) body.details = opts.details;
    if (opts.runtime !== undefined) body.runtime = opts.runtime;
    const task = unwrap(
      await postApiWorkspacesByIdTasks({
        path: { id: workspaceId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(task) : formatRecord({ ...task });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── show ──────────────────────────────────────────────────────────────
export type TaskShowOpts = WorkspaceFlagOpts;

export async function taskShow(taskId: string, opts: TaskShowOpts = {}): Promise<CommandResult> {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    return { exitCode: 2, stderr: "task id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const task = unwrap(
      await getApiWorkspacesByIdTasksByTid({
        path: { id: workspaceId, tid: taskId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(task) : formatRecord({ ...task });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// ─── rm ────────────────────────────────────────────────────────────────
export interface TaskRmOpts extends WorkspaceFlagOpts {
  readonly purge?: boolean;
}

export async function taskRm(taskId: string, opts: TaskRmOpts = {}): Promise<CommandResult> {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    return { exitCode: 2, stderr: "task id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { purge?: "1" } = {};
    if (opts.purge) query.purge = "1";
    // unwrap() even though the value is unused: it preserves the
    // throw-on-non-2xx behavior (a 409 must surface, not be swallowed).
    unwrap(
      await deleteApiWorkspacesByIdTasksByTid({
        path: { id: workspaceId, tid: taskId },
        query,
      }),
    );
    return { exitCode: 0, stdout: `task ${taskId} removed\n` };
  } catch (err) {
    // `task rm` on a non-terminal task surfaces a 409 with
    // code='InvalidTransition' + transition='delete'. Append a
    // one-line hint pointing the user at `task cancel` so the
    // terminal experience matches the dashboard's typed CTA.
    if (isStatusError(err, 409) && isInvalidTransition(err, "delete")) {
      const base = formatError(err);
      return {
        exitCode: 4,
        stderr: `${base.stderr ?? ""}Hint: use 'glyph task cancel ${taskId}' first.\n`,
      };
    }
    return formatError(err);
  }
}

// ─── cancel ────────────────────────────────────────────────────────────
export type TaskCancelOpts = WorkspaceFlagOpts;

/**
 * `glyph task cancel <task-id>` — POSTs to `tasks.cancel` and prints
 * either the updated Task as JSON or a one-line confirmation. Mirrors
 * the existing `task rm` shape. Exits 0 on success; on a 409 (already
 * terminal), `formatError` surfaces the structured body and the user
 * sees the typed message.
 */
export async function taskCancel(
  taskId: string,
  opts: TaskCancelOpts = {},
): Promise<CommandResult> {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    return { exitCode: 2, stderr: "task id is required\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const task = unwrap(
      await postApiWorkspacesByIdTasksByTidCancel({
        path: { id: workspaceId, tid: taskId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(task) };
    return { exitCode: 0, stdout: `task ${taskId} cancelled\n` };
  } catch (err) {
    return formatError(err);
  }
}

// ─── activity ──────────────────────────────────────────────────────────
export interface TaskActivityOpts extends WorkspaceFlagOpts {
  /** Tail the live activity stream over SSE; exits when the task terminates. */
  readonly follow?: boolean;
  /**
   * Backward pagination: return items with `seq < before`. Mutually
   * exclusive with --after; rejected by the server as 400 if both
   * are supplied. Use to walk older history one page at a time.
   */
  readonly before?: number;
  /**
   * Forward pagination: return items with `seq > after`. With
   * --follow, sent as `Last-Event-ID: <after>` to resume the SSE
   * stream from that seq. Without --follow, used as `?after=` query.
   */
  readonly after?: number;
  /** Maximum items per page. Server clamps to [1, 500]; default 50. */
  readonly limit?: number;
}

export async function taskActivity(
  taskId: string,
  opts: TaskActivityOpts = {},
): Promise<CommandResult> {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    return { exitCode: 2, stderr: "task id is required\n" };
  }
  if (opts.before !== undefined && opts.after !== undefined) {
    return {
      exitCode: 2,
      stderr: "--before and --after are mutually exclusive\n",
    };
  }
  if (opts.follow === true && opts.before !== undefined) {
    return {
      exitCode: 2,
      stderr:
        "--before cannot be combined with --follow (--follow resumes forward only; pass --after instead)\n",
    };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);

    if (opts.follow === true) {
      return await followTaskActivity(
        workspaceId,
        taskId,
        opts.after !== undefined ? { after: opts.after } : {},
      );
    }

    const query: { before?: number; after?: number; limit?: number } = {};
    if (opts.before !== undefined) query.before = opts.before;
    if (opts.after !== undefined) query.after = opts.after;
    if (opts.limit !== undefined) query.limit = opts.limit;
    const payload = unwrap(
      await getApiWorkspacesByIdTasksByTidActivity({
        path: { id: workspaceId, tid: taskId },
        query,
      }),
    );
    // Activity is intrinsically structured (variant ActivityItem types);
    // human-readable rendering is left to higher layers. Always JSON.
    return { exitCode: 0, stdout: formatJson(payload) };
  } catch (err) {
    return formatError(err);
  }
}

/**
 * Live-tail an in-progress task by streaming SSE from the
 * `/activity/stream` endpoint through the typed SDK operation. Each
 * ActivityItem is printed as a single NDJSON line on stdout (pipe-friendly:
 * `... | jq -c`, `... | grep error`).
 *
 * Exits 0 when the server sends `event: end` (task terminal) or the stream
 * closes cleanly. Exits 1 on a per-frame `error` payload or a transport
 * fault — the SDK stream is one-shot (reconnection is a non-goal; the user
 * re-runs). SIGINT (Ctrl+C) terminates the process between frames.
 *
 * Resume: pass `after` to send `Last-Event-ID: <after>` so the server replays
 * from that seq. Conversely, on every clean / mid-stream-error exit we print
 * `last seq: <N>` to stderr so the next invocation can resume:
 *
 *   glyph task activity <task-id> --follow                       # tail from now
 *   glyph task activity <task-id> --follow --after 1234          # resume from seq 1234
 *
 * Inside Ctrl+C the process dies between frames and stderr is not written;
 * recover the last seq from stdout instead (`... | tail -1 | jq .seq`) since
 * each printed item carries its own `seq`.
 */
export async function followTaskActivity(
  workspaceId: string,
  taskId: string,
  opts: { readonly after?: number } = {},
): Promise<CommandResult> {
  let stdout = "";
  // Seed lastSeq from the resume `after` so a stream that immediately ends
  // (nothing replayed) still yields a recoverable hint — e.g. `after` was
  // already at HEAD.
  let lastSeq: string | undefined = opts.after !== undefined ? String(opts.after) : undefined;
  let sawEnd = false;
  let protocolError: string | undefined;
  let transport: { status?: number; message: string } | undefined;

  const { stream } = await getApiWorkspacesByIdTasksByTidActivityStream({
    path: { id: workspaceId, tid: taskId },
    // One-shot: on a drop the SDK fires onSseError and stops (no retry). The
    // user re-runs (with `--after`) to resume — reconnection is a non-goal.
    sseMaxRetryAttempts: 1,
    ...(opts.after !== undefined ? { headers: { "Last-Event-ID": String(opts.after) } } : {}),
    onSseEvent: (ev) => {
      if (ev.id !== undefined) lastSeq = ev.id;
      switch (ev.event) {
        case "activity":
          // Single-line NDJSON: re-stringify (no indent) so multi-line item
          // content stays on one line.
          stdout += `${JSON.stringify(ev.data)}\n`;
          break;
        case "end":
          sawEnd = true;
          break;
        case "error":
          protocolError = streamErrorMessage(ev.data);
          break;
        // "heartbeat": keep-alive only.
      }
    },
    onSseError: (err) => {
      const status = sseErrorStatus(err);
      transport = {
        ...(status !== undefined ? { status } : {}),
        message: err instanceof Error ? err.message : String(err),
      };
    },
  });
  // Iterating drives the generator; all routing happens in `onSseEvent`.
  for await (const _frame of stream) {
    // no-op
  }

  if (transport?.status === 404) {
    return {
      exitCode: 1,
      stderr: `task ${taskId} has no streaming activity (terminal or missing)\n`,
    };
  }
  if (protocolError !== undefined) {
    return withResumeHint(
      { exitCode: 1, stdout, stderr: `stream error: ${protocolError}\n` },
      lastSeq,
    );
  }
  if (transport !== undefined && !sawEnd) {
    return withResumeHint(
      { exitCode: 1, stdout, stderr: `stream connection failed: ${transport.message}\n` },
      lastSeq,
    );
  }
  return withResumeHint({ exitCode: 0, stdout }, lastSeq);
}

/** Append a `last seq: <N>` resume hint to the result's stderr (no-op when no events were observed). */
function withResumeHint(result: CommandResult, lastSeq: string | undefined): CommandResult {
  if (lastSeq === undefined) return result;
  const tail = `last seq: ${lastSeq}\n`;
  const existing = result.stderr ?? "";
  return { ...result, stderr: `${existing}${tail}` };
}

/** Extract a human message from an `error` frame's parsed `data:` payload. */
function streamErrorMessage(data: unknown): string {
  if (
    data !== null &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  ) {
    return (data as { error: string }).error;
  }
  return JSON.stringify(data);
}

/**
 * Recover the HTTP status from the SDK SSE runtime's connection error, whose
 * message is `SSE failed: <status> <statusText>` (see the generated
 * `serverSentEvents.gen.ts`). Lets a 404 render the "no streaming activity"
 * message; returns undefined for non-HTTP faults (ECONNREFUSED, DNS, abort)
 * whose messages carry no status.
 */
function sseErrorStatus(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const m = /SSE failed: (\d{3})\b/.exec(err.message);
  return m ? Number.parseInt(m[1] as string, 10) : undefined;
}
