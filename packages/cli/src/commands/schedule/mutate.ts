/**
 * `glyph schedule ...` writes + operations on an existing schedule:
 * enable / disable (thin `schedules.patch` wrappers via `patchEnabled`),
 * rm, run (manual fire-now), and the general `patch` / `patch-workflow`
 * partial updates.
 */

import type {
  DeleteApiWorkspacesByIdSchedulesBySidResponses,
  GetApiWorkspacesByIdSchedulesBySidResponse,
  GetApiWorkspacesByIdSchedulesBySidResponses,
  PatchApiWorkspacesByIdSchedulesTaskBySidResponses,
  PatchApiWorkspacesByIdSchedulesWorkflowBySidResponses,
  PostApiWorkspacesByIdSchedulesBySidRunResponses,
} from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";

// --- enable / disable (thin wrappers over schedules.patch) -------------
export type ScheduleEnableOpts = WorkspaceFlagOpts;

export async function scheduleEnable(
  scheduleId: string,
  opts: ScheduleEnableOpts = {},
): Promise<CommandResult> {
  return patchEnabled(scheduleId, true, "enabled", opts);
}

export async function scheduleDisable(
  scheduleId: string,
  opts: ScheduleEnableOpts = {},
): Promise<CommandResult> {
  return patchEnabled(scheduleId, false, "disabled", opts);
}

async function patchEnabled(
  scheduleId: string,
  enabled: boolean,
  verb: string,
  opts: ScheduleEnableOpts,
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    // Detect the schedule's kind so we route to the correct patch endpoint.
    const found = unwrap(
      await client.get<GetApiWorkspacesByIdSchedulesBySidResponses>({
        url: "/api/workspaces/{id}/schedules/{sid}",
        path: { id: workspaceId, sid: scheduleId },
      }),
    );
    const kind = found.target?.kind ?? "task";
    const path = { id: workspaceId, sid: scheduleId };
    // The patch endpoint is kind-specific (task vs workflow); branch so
    // the response typing matches the URL we actually hit.
    const updated =
      kind === "workflow"
        ? unwrap(
            await client.patch<PatchApiWorkspacesByIdSchedulesWorkflowBySidResponses>({
              url: "/api/workspaces/{id}/schedules/workflow/{sid}",
              path,
              body: { enabled },
            }),
          )
        : unwrap(
            await client.patch<PatchApiWorkspacesByIdSchedulesTaskBySidResponses>({
              url: "/api/workspaces/{id}/schedules/task/{sid}",
              path,
              body: { enabled },
            }),
          );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `schedule ${scheduleId} ${verb}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- rm ----------------------------------------------------------------
export type ScheduleRmOpts = WorkspaceFlagOpts;

export async function scheduleRm(
  scheduleId: string,
  opts: ScheduleRmOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await client.delete<DeleteApiWorkspacesByIdSchedulesBySidResponses>({
        url: "/api/workspaces/{id}/schedules/{sid}",
        path: { id: workspaceId, sid: scheduleId },
      }),
    );
    const n = result.deletedDispatchCount;
    const suffix =
      n === 0 ? "" : n === 1 ? " (and 1 historical dispatch)" : ` (and ${n} historical dispatches)`;
    return { exitCode: 0, stdout: `schedule ${scheduleId} removed${suffix}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- run (manual fire-now) ---------------------------------------------
export type ScheduleRunOpts = WorkspaceFlagOpts;

export async function scheduleRun(
  scheduleId: string,
  opts: ScheduleRunOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const result = unwrap(
      await client.post<PostApiWorkspacesByIdSchedulesBySidRunResponses>({
        url: "/api/workspaces/{id}/schedules/{sid}/run",
        path: { id: workspaceId, sid: scheduleId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(result) };
    return { exitCode: 0, stdout: `${result.dispatchId}\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- patch (general partial update) ------------------------------------
export interface SchedulePatchOpts extends WorkspaceFlagOpts {
  readonly name?: string;
  readonly cron?: string;
  readonly tz?: string;
  readonly agent?: string;
  /** Replace the brief. Mirrors `glyph task dispatch --brief` validation. */
  readonly brief?: string;
  /**
   * Replace the details with `value` (including `""` -- mirrors the
   * task CLI's lax shape). Mutually exclusive with --clear-details.
   *
   * Note: glyph's `pickString` collapses `--details ""` to undefined
   * (treated as omitted) at the commander boundary, so the empty-string
   * SET case is only reachable via direct API / dashboard.
   */
  readonly details?: string;
  /**
   * Remove `details` from the patched target entirely (sends
   * `target.details: null` on the wire -- RFC 7396 delete semantics).
   * Distinct from `--details ""`, which SETS details to the empty
   * string. Mutually exclusive with --details.
   */
  readonly clearDetails?: boolean;
  readonly runtime?: string;
  /**
   * Remove `runtime` from the patched target entirely (sends
   * `target.runtime: null` on the wire -- RFC 7396 delete semantics).
   * Mutually exclusive with --runtime.
   */
  readonly clearRuntime?: boolean;
  readonly enabled?: boolean;
}

export async function schedulePatch(
  scheduleId: string,
  opts: SchedulePatchOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }

  if (opts.clearDetails === true && opts.details !== undefined) {
    return {
      exitCode: 2,
      stderr: "--details and --clear-details are mutually exclusive\n",
    };
  }
  if (opts.clearRuntime === true && opts.runtime !== undefined) {
    return {
      exitCode: 2,
      stderr: "--runtime and --clear-runtime are mutually exclusive\n",
    };
  }

  // Validate --brief content up-front (mirrors `scheduleCreate`):
  // non-empty, no newlines, <= 200 trimmed chars.
  if (opts.brief !== undefined) {
    if (typeof opts.brief !== "string" || opts.brief.trim() === "") {
      return { exitCode: 2, stderr: "--brief must be a non-empty string\n" };
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
  }

  const touchesTrigger = opts.cron !== undefined || opts.tz !== undefined;
  const touchesTarget =
    opts.agent !== undefined ||
    opts.brief !== undefined ||
    opts.details !== undefined ||
    opts.clearDetails === true ||
    opts.runtime !== undefined ||
    opts.clearRuntime === true;
  const touchesAny =
    opts.name !== undefined || touchesTrigger || touchesTarget || opts.enabled !== undefined;
  if (!touchesAny) {
    return {
      exitCode: 2,
      stderr:
        "at least one of --name / --cron / --tz / --agent / --brief / --details / --clear-details / --runtime / --clear-runtime / --enabled is required\n",
    };
  }

  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);

    // `target` is RFC 7396 deep-merged server-side (see
    // packages/server/src/routes/schedules.ts `PATCH /task/:sid`),
    // so the CLI no longer needs to GET-merge target leaves before
    // sending the patch. `trigger`, however, is still wholesale-
    // replace (small atomic shape), so a partial trigger update
    // (--cron OR --tz, but not both) still requires one GET to fill
    // the other field. This is the only remaining GET-merge case.
    let current: GetApiWorkspacesByIdSchedulesBySidResponse | undefined;
    const needCurrentForTrigger =
      touchesTrigger && !(opts.cron !== undefined && opts.tz !== undefined);
    if (needCurrentForTrigger) {
      current = unwrap(
        await client.get<GetApiWorkspacesByIdSchedulesBySidResponses>({
          url: "/api/workspaces/{id}/schedules/{sid}",
          path: { id: workspaceId, sid: scheduleId },
        }),
      );
    }

    const body: {
      name?: string;
      trigger?: { kind: "cron"; expr: string; tz: string };
      target?: {
        agent?: string;
        brief?: string;
        details?: string | null;
        runtime?: string | null;
      };
      enabled?: boolean;
    } = {};

    if (opts.name !== undefined) body.name = opts.name;
    if (opts.enabled !== undefined) body.enabled = opts.enabled;

    if (touchesTrigger) {
      const existingTrigger = current?.trigger;
      // `trigger` is type-unioned over kinds; cron is currently the
      // only modelled kind. Refuse `--cron / --tz` if the existing
      // trigger is a non-cron kind so a contract addition doesn't
      // get silently coerced through these flags.
      if (existingTrigger !== undefined && existingTrigger.kind !== "cron") {
        return {
          exitCode: 2,
          stderr: `--cron / --tz only supported when current trigger.kind === "cron" (got "${existingTrigger.kind}")\n`,
        };
      }
      const expr = opts.cron ?? existingTrigger?.expr;
      const tz = opts.tz ?? existingTrigger?.tz;
      if (expr === undefined || tz === undefined) {
        // Unreachable in practice -- GET must return a complete
        // trigger when one exists -- but keep the defensive guard so
        // a contract regression surfaces with a clear message instead
        // of as an opaque server 400.
        return { exitCode: 2, stderr: "internal: could not resolve cron/tz from server\n" };
      }
      body.trigger = { kind: "cron", expr, tz };
    }

    if (touchesTarget) {
      // Sparse target -- server deep-merges per field. No GET needed.
      const nextTarget: {
        agent?: string;
        brief?: string;
        details?: string | null;
        runtime?: string | null;
      } = {};
      if (opts.agent !== undefined) nextTarget.agent = opts.agent;
      if (opts.brief !== undefined) nextTarget.brief = opts.brief.trim();
      if (opts.clearDetails === true) nextTarget.details = null;
      else if (opts.details !== undefined) nextTarget.details = opts.details;
      if (opts.clearRuntime === true) nextTarget.runtime = null;
      else if (opts.runtime !== undefined) nextTarget.runtime = opts.runtime;
      body.target = nextTarget;
    }

    const updated = unwrap(
      await client.patch<PatchApiWorkspacesByIdSchedulesTaskBySidResponses>({
        url: "/api/workspaces/{id}/schedules/task/{sid}",
        path: { id: workspaceId, sid: scheduleId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `schedule ${scheduleId} patched\n` };
  } catch (err) {
    return formatError(err);
  }
}

// --- patch-workflow (workflow-kind partial update) ----------------------
export interface SchedulePatchWorkflowOpts extends WorkspaceFlagOpts {
  readonly name?: string;
  readonly cron?: string;
  readonly tz?: string;
  readonly coordAgent?: string;
  readonly brief?: string;
  readonly details?: string;
  readonly clearDetails?: boolean;
  readonly enabled?: boolean;
}

export async function schedulePatchWorkflow(
  scheduleId: string,
  opts: SchedulePatchWorkflowOpts = {},
): Promise<CommandResult> {
  if (typeof scheduleId !== "string" || scheduleId.trim() === "") {
    return { exitCode: 2, stderr: "schedule id is required\n" };
  }

  if (opts.clearDetails === true && opts.details !== undefined) {
    return {
      exitCode: 2,
      stderr: "--details and --clear-details are mutually exclusive\n",
    };
  }

  if (opts.brief !== undefined) {
    if (typeof opts.brief !== "string" || opts.brief.trim() === "") {
      return { exitCode: 2, stderr: "--brief must be a non-empty string\n" };
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
  }

  const touchesTrigger = opts.cron !== undefined || opts.tz !== undefined;
  const touchesTarget =
    opts.coordAgent !== undefined ||
    opts.brief !== undefined ||
    opts.details !== undefined ||
    opts.clearDetails === true;
  const touchesAny =
    opts.name !== undefined || touchesTrigger || touchesTarget || opts.enabled !== undefined;
  if (!touchesAny) {
    return {
      exitCode: 2,
      stderr:
        "at least one of --name / --cron / --tz / --coord-agent / --brief / --details / --clear-details / --enabled is required\n",
    };
  }

  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);

    let current: GetApiWorkspacesByIdSchedulesBySidResponse | undefined;
    const needCurrentForTrigger =
      touchesTrigger && !(opts.cron !== undefined && opts.tz !== undefined);
    if (needCurrentForTrigger) {
      current = unwrap(
        await client.get<GetApiWorkspacesByIdSchedulesBySidResponses>({
          url: "/api/workspaces/{id}/schedules/{sid}",
          path: { id: workspaceId, sid: scheduleId },
        }),
      );
    }

    const body: {
      name?: string;
      trigger?: { kind: "cron"; expr: string; tz: string };
      target?: {
        coordinatorAgent?: string;
        brief?: string;
        details?: string | null;
      };
      enabled?: boolean;
    } = {};

    if (opts.name !== undefined) body.name = opts.name;
    if (opts.enabled !== undefined) body.enabled = opts.enabled;

    if (touchesTrigger) {
      const existingTrigger = current?.trigger;
      if (existingTrigger !== undefined && existingTrigger.kind !== "cron") {
        return {
          exitCode: 2,
          stderr: `--cron / --tz only supported when current trigger.kind === "cron" (got "${existingTrigger.kind}")\n`,
        };
      }
      const expr = opts.cron ?? existingTrigger?.expr;
      const tz = opts.tz ?? existingTrigger?.tz;
      if (expr === undefined || tz === undefined) {
        return { exitCode: 2, stderr: "internal: could not resolve cron/tz from server\n" };
      }
      body.trigger = { kind: "cron", expr, tz };
    }

    if (touchesTarget) {
      const nextTarget: {
        coordinatorAgent?: string;
        brief?: string;
        details?: string | null;
      } = {};
      if (opts.coordAgent !== undefined) nextTarget.coordinatorAgent = opts.coordAgent;
      if (opts.brief !== undefined) nextTarget.brief = opts.brief.trim();
      if (opts.clearDetails === true) nextTarget.details = null;
      else if (opts.details !== undefined) nextTarget.details = opts.details;
      body.target = nextTarget;
    }

    const updated = unwrap(
      await client.patch<PatchApiWorkspacesByIdSchedulesWorkflowBySidResponses>({
        url: "/api/workspaces/{id}/schedules/workflow/{sid}",
        path: { id: workspaceId, sid: scheduleId },
        body,
      }),
    );
    const fmt = pickFormat(opts, "table");
    if (fmt === "json") return { exitCode: 0, stdout: formatJson(updated) };
    return { exitCode: 0, stdout: `schedule ${scheduleId} patched\n` };
  } catch (err) {
    return formatError(err);
  }
}
