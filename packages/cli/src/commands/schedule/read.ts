/**
 * `glyph schedule ...` reads -- list / show / preview plus the
 * `list-tasks` / `list-workflows` projections over the sibling
 * `tasks.scheduled.list` / `workflows.scheduled.list` routes.
 */

import {
  type GetApiWorkspacesByIdScheduledTasksData,
  getApiWorkspacesByIdScheduledTasks,
  getApiWorkspacesByIdScheduledWorkflows,
  getApiWorkspacesByIdSchedulesTask,
  getApiWorkspacesByIdSchedulesTaskBySid,
  getApiWorkspacesByIdSchedulesTaskBySidPreview,
  getApiWorkspacesByIdSchedulesWorkflow,
  getApiWorkspacesByIdSchedulesWorkflowBySid,
  getApiWorkspacesByIdSchedulesWorkflowBySidPreview,
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const enabledQuery = opts.enabled as "true" | "false" | undefined;
    const [taskResult, wfResult] = await Promise.all([
      getApiWorkspacesByIdSchedulesTask({
        path: { id: workspaceId },
        query: {
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
          ...(enabledQuery !== undefined ? { enabled: enabledQuery } : {}),
        },
      }),
      getApiWorkspacesByIdSchedulesWorkflow({
        path: { id: workspaceId },
        query: {
          ...(opts.agent !== undefined ? { coordinatorAgent: opts.agent } : {}),
          ...(enabledQuery !== undefined ? { enabled: enabledQuery } : {}),
        },
      }),
    ]);
    const taskList = unwrap(taskResult);
    const wfList = unwrap(wfResult);
    const fmt = pickFormat(opts, "table");
    const allItems = [
      ...taskList.map((s) => ({
        id: s.id,
        name: s.name,
        kind: "task" as const,
        agent: s.target.agent,
        expr: s.trigger.expr,
        tz: s.trigger.tz,
        enabled: s.enabled,
      })),
      ...wfList.map((s) => ({
        id: s.id,
        name: s.name,
        kind: "workflow" as const,
        agent: s.target.coordinatorAgent,
        expr: s.trigger.expr,
        tz: s.trigger.tz,
        enabled: s.enabled,
      })),
    ];
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(allItems) };
    return {
      exitCode: 0,
      stdout: formatTable(
        ["id", "name", "kind", "agent", "cron", "tz", "enabled"],
        allItems.map((s) => [s.id, s.name, s.kind, s.agent, s.expr, s.tz, String(s.enabled)]),
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const taskResult = await getApiWorkspacesByIdSchedulesTaskBySid({
      path: { id: workspaceId, sid: scheduleId },
    });
    const fmt = pickFormat(opts, "table");
    if (taskResult.response?.status === 404) {
      const found = unwrap(
        await getApiWorkspacesByIdSchedulesWorkflowBySid({
          path: { id: workspaceId, sid: scheduleId },
        }),
      );
      if (fmt === "json") return { exitCode: 0, stdout: formatJson(found) };
      const { id, name, describe, ...rest } = found;
      return { exitCode: 0, stdout: formatRecord({ id, name, describe, ...rest }) };
    }
    const found = unwrap(taskResult);
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(found) };
    const { id, name, describe, ...rest } = found;
    return { exitCode: 0, stdout: formatRecord({ id, name, describe, ...rest }) };
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { n?: number } = {};
    if (opts.n !== undefined) query.n = opts.n;
    const taskResult = await getApiWorkspacesByIdSchedulesTaskBySidPreview({
      path: { id: workspaceId, sid: scheduleId },
      query,
    });
    const preview =
      taskResult.response?.status === 404
        ? unwrap(
            await getApiWorkspacesByIdSchedulesWorkflowBySidPreview({
              path: { id: workspaceId, sid: scheduleId },
              query,
            }),
          )
        : unwrap(taskResult);
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
  /** One of the TaskStatus values (running, succeeded, failed, cancelled). */
  readonly status?: string;
}

export async function scheduleListTasks(opts: ScheduleListTasksOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: NonNullable<GetApiWorkspacesByIdScheduledTasksData["query"]> = {};
    if (opts.scheduleId !== undefined) query.scheduleId = opts.scheduleId;
    if (opts.agent !== undefined) query.agent = opts.agent;
    if (opts.runtime !== undefined) query.runtime = opts.runtime;
    if (opts.createdSince !== undefined) query.createdSince = opts.createdSince;
    // `opts.status` is a raw CLI string; the server validates it against the
    // TaskStatus enum and returns a 400 (surfaced as-is) for a bad value.
    if (opts.status !== undefined) {
      query.status = opts.status as NonNullable<
        NonNullable<GetApiWorkspacesByIdScheduledTasksData["query"]>["status"]
      >;
    }
    const list = unwrap(
      await getApiWorkspacesByIdScheduledTasks({
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
          return [
            (t as { id?: string }).id ?? "",
            (t as { agent?: string }).agent ?? "",
            (t as { status?: string }).status ?? "",
            (t as { originId?: string }).originId ?? "",
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
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const query: { scheduleId?: string } = {};
    if (opts.scheduleId !== undefined) query.scheduleId = opts.scheduleId;
    const list = unwrap(
      await getApiWorkspacesByIdScheduledWorkflows({
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
          const scheduleId = typeof w.originId === "string" ? w.originId : "";
          return [w.id, w.coordinatorAgent, w.status, scheduleId, w.createdAt];
        }),
      ),
    };
  } catch (err) {
    return formatError(err);
  }
}
