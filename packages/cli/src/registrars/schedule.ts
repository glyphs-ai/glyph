/**
 * `schedule` subtree registrar. Pure relocation from `index.ts` —
 * each of the 10 schedule commands has a unique shape (`patch` alone
 * carries 10+ options), so collapsing them into a data-driven loop
 * would obscure intent more than it would save. The wiring stays
 * flat; only the file boundary moves.
 *
 * Help-text, option flags, ordering, and command names are preserved
 * by the argv and help-output tests.
 */

import type { Command } from "commander";
import {
  scheduleCreate,
  scheduleDisable,
  scheduleEnable,
  scheduleList,
  scheduleListTasks,
  schedulePatch,
  schedulePreview,
  scheduleRm,
  scheduleRun,
  scheduleShow,
} from "../commands/schedule.js";
import {
  optionalString,
  parseWorkspaceFlags,
  pickString,
  type Slot,
  withWorkspaceFlags,
} from "./_shared.js";

export function registerScheduleCommands(program: Command, slot: Slot): void {
  const scheduleCmd = program
    .command("schedule")
    .description("Schedule operations (workspace-scoped cron triggers)");

  withWorkspaceFlags(scheduleCmd.command("list"))
    .description("List schedules in the current workspace")
    .option("--agent <fqn>", "Filter to schedules targeting this agent")
    .option("--enabled <bool>", 'Filter on enabled flag ("true" | "false")')
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await scheduleList({
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "agent"),
        ...optionalString(opts, "enabled"),
      });
    });
  withWorkspaceFlags(scheduleCmd.command("create"))
    .description("Create a new schedule")
    .requiredOption("--name <text>", "Human-readable display name")
    .requiredOption("--agent <fqn>", "Agent to dispatch (e.g. official/engineer)")
    .requiredOption(
      "--brief <text>",
      "Single-line task title (≤ 200 chars; mirrors `glyph task dispatch --brief`)",
    )
    .option(
      "--details <text>",
      'Optional multi-line task body (mirrors `glyph task dispatch --details`; "" is treated as omitted)',
    )
    .requiredOption("--cron <expr>", "5-field cron expression")
    .requiredOption("--tz <iana>", "IANA timezone (e.g. UTC, Asia/Shanghai)")
    .option("--runtime <kind>", "Runtime override (default: copilot)")
    .option("--disabled", "Create in disabled state (default: enabled)", false)
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await scheduleCreate({
        ...parseWorkspaceFlags(opts),
        name: pickString(opts, "name") ?? "",
        agent: pickString(opts, "agent") ?? "",
        brief: pickString(opts, "brief") ?? "",
        ...optionalString(opts, "details"),
        cron: pickString(opts, "cron") ?? "",
        tz: pickString(opts, "tz") ?? "",
        ...optionalString(opts, "runtime"),
        disabled: opts.disabled === true,
      });
    });
  withWorkspaceFlags(scheduleCmd.command("show"))
    .argument("<schedule-id>", "Schedule id")
    .description("Print one schedule's metadata")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await scheduleShow(scheduleId, parseWorkspaceFlags(opts));
    });
  withWorkspaceFlags(scheduleCmd.command("enable"))
    .argument("<schedule-id>", "Schedule id")
    .description("Enable a schedule (re-arms the timer)")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await scheduleEnable(scheduleId, parseWorkspaceFlags(opts));
    });
  withWorkspaceFlags(scheduleCmd.command("disable"))
    .argument("<schedule-id>", "Schedule id")
    .description("Disable a schedule (cancels timer; in-flight tasks unaffected)")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await scheduleDisable(scheduleId, parseWorkspaceFlags(opts));
    });
  withWorkspaceFlags(scheduleCmd.command("patch"))
    .argument("<schedule-id>", "Schedule id")
    .description(
      "Partially update a schedule (any subset of name / cron / tz / agent / brief / details / clear-details / runtime / clear-runtime / enabled)",
    )
    .option("--name <text>", "New display name")
    .option(
      "--cron <expr>",
      "New cron expression (5/6/7-field; preserves existing tz unless --tz also given)",
    )
    .option(
      "--tz <iana>",
      "New IANA timezone (preserves existing cron expr unless --cron also given)",
    )
    .option(
      "--agent <fqn>",
      "New agent FQN (preserves existing brief/details/runtime unless those flags are also given)",
    )
    .option(
      "--brief <text>",
      "New single-line brief (≤ 200 chars; mirrors `glyph task dispatch --brief`)",
    )
    .option(
      "--details <text>",
      'New details body (mirrors `glyph task dispatch --details`; "" is treated as omitted — use --clear-details to remove)',
    )
    .option("--clear-details", "Remove existing details from the schedule's task target")
    .option("--runtime <kind>", "New runtime override")
    .option("--clear-runtime", "Remove existing runtime override from the schedule's task target")
    .option("--enabled", "Re-arm timer (equivalent to `enable` subcommand)")
    .option("--no-enabled", "Cancel timer (equivalent to `disable` subcommand)")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await schedulePatch(scheduleId, {
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "name"),
        ...optionalString(opts, "cron"),
        ...optionalString(opts, "tz"),
        ...optionalString(opts, "agent"),
        ...optionalString(opts, "brief"),
        ...optionalString(opts, "details"),
        ...(opts.clearDetails === true ? { clearDetails: true } : {}),
        ...optionalString(opts, "runtime"),
        ...(opts.clearRuntime === true ? { clearRuntime: true } : {}),
        ...(opts.enabled !== undefined ? { enabled: Boolean(opts.enabled) } : {}),
      });
    });
  withWorkspaceFlags(scheduleCmd.command("rm"))
    .argument("<schedule-id>", "Schedule id")
    .description("Delete a schedule (refuses if enabled or has in-flight tasks)")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await scheduleRm(scheduleId, parseWorkspaceFlags(opts));
    });
  withWorkspaceFlags(scheduleCmd.command("run"))
    .argument("<schedule-id>", "Schedule id")
    .description("Fire a schedule now (out-of-band; does not advance the cron cursor)")
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      slot.result = await scheduleRun(scheduleId, parseWorkspaceFlags(opts));
    });
  withWorkspaceFlags(scheduleCmd.command("preview"))
    .argument("<schedule-id>", "Schedule id")
    .description("Show next fire times + cron description")
    .option("-n <count>", "Number of fires to compute (1..100)", (v) => Number.parseInt(v, 10))
    .action(async (scheduleId: string, opts: Record<string, unknown>) => {
      const n = typeof opts.n === "number" ? opts.n : undefined;
      slot.result = await schedulePreview(scheduleId, {
        ...parseWorkspaceFlags(opts),
        ...(n !== undefined ? { n } : {}),
      });
    });
  withWorkspaceFlags(scheduleCmd.command("list-tasks"))
    .description("List tasks launched by this workspace's schedules")
    .option("--schedule-id <id>", "Filter to one schedule's runs")
    .option("--agent <fqn>", "Filter by agent")
    .option("--runtime <kind>", "Filter by runtime kind")
    .option("--created-since <iso>", "Drop tasks created before this ISO 8601 timestamp")
    .option("--status <csv>", "Comma-separated list (running, succeeded, failed, cancelled)")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await scheduleListTasks({
        ...parseWorkspaceFlags(opts),
        ...optionalString(opts, "scheduleId"),
        ...optionalString(opts, "agent"),
        ...optionalString(opts, "runtime"),
        ...optionalString(opts, "createdSince"),
        ...optionalString(opts, "status"),
      });
    });
}
