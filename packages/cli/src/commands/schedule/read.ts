/**
 * `glyph schedule ...` reads -- list / show / preview plus the
 * `list-tasks` / `list-workflows` projections over the sibling
 * `tasks.scheduled.list` / `workflows.scheduled.list` routes.
 */

import type {
  GetApiWorkspacesByIdScheduledTasksResponses,
  GetApiWorkspacesByIdScheduledWorkflowsResponses,
  GetApiWorkspacesByIdSchedulesBySidPreviewResponses,
  GetApiWorkspacesByIdSchedulesBySidResponses,
  GetApiWorkspacesByIdSchedulesResponses,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatRecord, formatTable, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";

// --- list --------------------------------------------------------------
export interface ScheduleListOpts extends WorkspaceFlagOpts {
  readonly agent?: string;
  /** `"true"` / `"false"` -- passed through as the query param's string value. */
  readonly enabled?: string;
}

export async function scheduleList(opts: ScheduleListOpts = {}): Promise<CommandResult> {
  if (opts.enabled !== undefined && opts.enabled !== "true" && opts.enabled !== "false") {
    return {
      exitCode: 2,
      stderr: '--enabled must be "true" or "false"\n',
    };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { agent?: string; enabled?: "true" | "false" } = {};
    if (opts.agent !== undefined) query.agent = opts.agent;
    if (opts.enabled !== undefined) query.enabled = opts.enabled as "true" | "false";
    const list = unwrap(
      await client.get<GetApiWorkspacesByIdSchedulesResponses>({
        url: "/api/workspaces/{id}/schedules",
        path: { id: workspaceId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "name", "kind", "agent", "cron", "tz", "enabled"],
        list.map((s) => {
          const target = s.target as {
            kind: string;
            agent?: string;
            coordinatorAgent?: string;
          };
          const agentCol =
            target.kind === "task"
              ? (target.agent ?? "")
              : target.kind === "workflow"
                ? (target.coordinatorAgent ?? "")
                : "";
          return [
            s.id ?? "",
            s.name ?? "",
            target.kind ?? "",
            agentCol,
            s.trigger?.kind === "cron" ? (s.trigger.expr ?? "") : "",
            s.trigger?.kind === "cron" ? (s.trigger.tz ?? "") : "",
            String(s.enabled),
          ];
        }),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- show --------------------------------------------------------------
export type ScheduleShowOpts = WorkspaceFlagOpts;

export async function scheduleShow(
  scheduleId: string,
  opts: ScheduleShowOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const found = unwrap(
      await client.get<GetApiWorkspacesByIdSchedulesBySidResponses>({
        url: "/api/workspaces/{id}/schedules/{sid}",
        path: { id: workspaceId, sid: scheduleId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(found) };
    // Surface `describe` (the derived zh_CN cron text the server
    // adds to GET /:sid) right after `name` so it lands above the
    // structured `trigger` / `target` JSON blobs in the table view.
    const { id: foundId, name, describe, ...rest } = found;
    const stdout = formatRecord({
      id: foundId,
      name,
      describe: describe ?? "(no description)",
      ...rest,
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// --- preview -----------------------------------------------------------
export interface SchedulePreviewOpts extends WorkspaceFlagOpts {
  /** Number of upcoming fires to compute (1..100). */
  readonly n?: number;
}

export async function schedulePreview(
  scheduleId: string,
  opts: SchedulePreviewOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }
  if (opts.n !== undefined && (!Number.isInteger(opts.n) || opts.n < 1 || opts.n > 100)) {
    return { exitCode: 2, stderr: "-n must be an integer in [1, 100]\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { n?: string } = {};
    if (opts.n !== undefined) query.n = String(opts.n);
    const preview = unwrap(
      await client.get<GetApiWorkspacesByIdSchedulesBySidPreviewResponses>({
        url: "/api/workspaces/{id}/schedules/{sid}/preview",
        path: { id: workspaceId, sid: scheduleId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(preview) };
    const lines = [preview.describe, ...preview.nextRuns.map((ts) => `  ${ts}`)];
    return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- list-tasks (wraps scheduledTasks.list) ----------------------------
export interface ScheduleListTasksOpts extends WorkspaceFlagOpts {
  readonly scheduleId?: string;
  readonly agent?: string;
  readonly runtime?: string;
  readonly createdSince?: string;
  /** Comma-separated TaskStatus values. */
  readonly status?: string;
}

export async function scheduleListTasks(opts: ScheduleListTasksOpts = {}): Promise<CommandResult> {
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: {
      scheduleId?: string;
      agent?: string;
      runtime?: string;
      createdSince?: string;
      status?: string;
    } = {};
    if (opts.scheduleId !== undefined) query.scheduleId = opts.scheduleId;
    if (opts.agent !== undefined) query.agent = opts.agent;
    if (opts.runtime !== undefined) query.runtime = opts.runtime;
    if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
    if (opts.status !== undefined) query.status = opts.status;
    const list = unwrap(
      await client.get<GetApiWorkspacesByIdScheduledTasksResponses>({
        url: "/api/workspaces/{id}/scheduled-tasks",
        path: { id: workspaceId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "agent", "status", "scheduleId", "createdAt"],
        list.map((t) => {
          const meta = (t as { metadata?: { scheduleId?: string } }).metadata;
          return [
            (t as { id?: string }).id ?? "",
            (t as { agent?: string }).agent ?? "",
            (t as { status?: string }).status ?? "",
            meta?.scheduleId ?? "",
            (t as { createdAt?: string }).createdAt ?? "",
          ];
        }),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}

// --- list-workflows (wraps scheduledWorkflows.list) ---------------------
export interface ScheduleListWorkflowsOpts extends WorkspaceFlagOpts {
  readonly scheduleId?: string;
}

export async function scheduleListWorkflows(
  opts: ScheduleListWorkflowsOpts = {},
): Promise<CommandResult> {
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { scheduleId?: string } = {};
    if (opts.scheduleId !== undefined) query.scheduleId = opts.scheduleId;
    const list = unwrap(
      await client.get<GetApiWorkspacesByIdScheduledWorkflowsResponses>({
        url: "/api/workspaces/{id}/scheduled-workflows",
        path: { id: workspaceId },
        query,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(list) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "coordinatorAgent", "status", "scheduleId", "createdAt"],
        list.map((w) => {
          const scheduleId = typeof w.metadata.scheduleId === "string" ? w.metadata.scheduleId : "";
          return [w.id, w.coordinatorAgent, w.status, scheduleId, w.createdAt];
        }),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}
