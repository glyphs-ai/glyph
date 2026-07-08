import type { BuildInteractiveLaunchOpts, LaunchCommand } from "../types.js";

/**
 * Build the launch command for `opts.workdir`. Opens the opencode TUI
 * in the provisioned workdir with auto-permission approval enabled.
 *
 * When `runtimeSessionId` is non-null, `--session <id>` is appended to
 * resume the existing opencode session (e.g. after a disconnect). When
 * null, opencode starts a fresh session without specifying an ID — the
 * CLI mints its own `ses_<ulid>` at launch time.
 *
 * `--auto` auto-approves tool-use permissions that are not explicitly
 * denied, removing the interactive confirmation prompts that would
 * otherwise block a dashboard-driven launch.
 */
export function buildOpencodeLaunchCommand(
  runtimeSessionId: string | null,
  opts: Pick<BuildInteractiveLaunchOpts, "workdir">,
): LaunchCommand {
  const args: string[] = [];
  if (runtimeSessionId !== null) {
    args.push("--session", runtimeSessionId);
  }
  args.push("--auto");
  return {
    cmd: "opencode",
    args,
    cwd: opts.workdir,
    display: `cd ${quote(opts.workdir)} && opencode ${args.join(" ")}`,
  };
}

/** Minimal cross-platform quoting for display strings (not for shell exec). */
function quote(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}
