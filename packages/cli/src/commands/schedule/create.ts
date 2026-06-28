/**
 * `glyph schedule create` / `create-workflow` -- register a new
 * task-kind or workflow-kind cron schedule.
 */

import {
  postApiWorkspacesByIdSchedulesTask,
  postApiWorkspacesByIdSchedulesWorkflow,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatRecord, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";

// --- create ------------------------------------------------------------
export interface ScheduleCreateOpts extends WorkspaceFlagOpts {
  readonly name: string;
  readonly agent: string;
  /** Short, single-line task title (<= 200 chars). Required. */
  readonly brief: string;
  /** Optional long-form details. Multi-line allowed. */
  readonly details?: string;
  readonly cron: string;
  readonly tz: string;
  readonly runtime?: string;
  /** When true, the schedule is created in disabled state. Defaults to false (enabled). */
  readonly disabled?: boolean;
}

export async function scheduleCreate(opts: ScheduleCreateOpts): Promise<CommandResult> {
  if (typeof opts.name !== "string" || opts.name.trim() === "") {
    return { exitCode: 2, stderr: "missing required --name <text>\n" };
  }
  if (typeof opts.agent !== "string" || opts.agent.trim() === "") {
    return { exitCode: 2, stderr: "missing required --agent <fqn>\n" };
  }
  // --brief mirrors `glyph task dispatch --brief` exactly (see
  // commands/task.ts): required, no newlines, <= 200 trimmed chars.
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
  if (typeof opts.cron !== "string" || opts.cron.trim() === "") {
    return { exitCode: 2, stderr: "missing required --cron <expr>\n" };
  }
  if (typeof opts.tz !== "string" || opts.tz.trim() === "") {
    return { exitCode: 2, stderr: "missing required --tz <iana>\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    // No `kind` field -- the URL (`POST /schedules/task`) declares it.
    const target: {
      agent: string;
      brief: string;
      details?: string;
      runtime?: string;
    } = {
      agent: opts.agent,
      brief: opts.brief.trim(),
    };
    if (opts.details !== undefined) target.details = opts.details;
    if (opts.runtime !== undefined) target.runtime = opts.runtime;
    const body = {
      name: opts.name,
      target,
      trigger: { kind: "cron" as const, expr: opts.cron, tz: opts.tz },
      enabled: !opts.disabled,
    };
    const created = unwrap(
      await postApiWorkspacesByIdSchedulesTask({
        path: { id: workspaceId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(created) : formatRecord({ ...created });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}

// --- create-workflow ---------------------------------------------------
export interface ScheduleCreateWorkflowOpts extends WorkspaceFlagOpts {
  readonly name: string;
  readonly coordAgent: string;
  /** Short, single-line workflow title (<= 200 chars). Required. */
  readonly brief: string;
  /** Optional long-form details. Multi-line allowed. */
  readonly details?: string;
  readonly cron: string;
  readonly tz: string;
  /** When true, the schedule is created in disabled state. Defaults to false (enabled). */
  readonly disabled?: boolean;
}

export async function scheduleCreateWorkflow(
  opts: ScheduleCreateWorkflowOpts,
): Promise<CommandResult> {
  if (typeof opts.name !== "string" || opts.name.trim() === "") {
    return { exitCode: 2, stderr: "missing required --name <text>\n" };
  }
  if (typeof opts.coordAgent !== "string" || opts.coordAgent.trim() === "") {
    return { exitCode: 2, stderr: "missing required --coord-agent <fqn>\n" };
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
  if (typeof opts.cron !== "string" || opts.cron.trim() === "") {
    return { exitCode: 2, stderr: "missing required --cron <expr>\n" };
  }
  if (typeof opts.tz !== "string" || opts.tz.trim() === "") {
    return { exitCode: 2, stderr: "missing required --tz <iana>\n" };
  }
  await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const target: {
      coordinatorAgent: string;
      brief: string;
      details?: string;
    } = {
      coordinatorAgent: opts.coordAgent,
      brief: opts.brief.trim(),
    };
    if (opts.details !== undefined) target.details = opts.details;
    const body = {
      name: opts.name,
      target,
      trigger: { kind: "cron" as const, expr: opts.cron, tz: opts.tz },
      enabled: !opts.disabled,
    };
    const created = unwrap(
      await postApiWorkspacesByIdSchedulesWorkflow({
        path: { id: workspaceId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(created) : formatRecord({ ...created });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}
