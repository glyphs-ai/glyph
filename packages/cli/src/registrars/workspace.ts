import type { Command } from "commander";
import {
  workspaceAdd,
  workspaceCurrent,
  workspaceList,
  workspaceReload,
  workspaceRm,
  workspaceShow,
  workspaceUpdate,
} from "../commands/workspace.js";
import {
  optionalString,
  parseConnectFlags,
  pickString,
  type Slot,
  withConnectFlags,
} from "./_shared.js";

export function registerWorkspaceCommands(program: Command, slot: Slot): void {
  const workspaceCmd = program.command("workspace").description("Workspace operations");

  withConnectFlags(workspaceCmd.command("list"))
    .description("List all workspaces")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await workspaceList(parseConnectFlags(opts));
    });

  withConnectFlags(workspaceCmd.command("add"))
    .description("Create a new workspace")
    .requiredOption("--name <name>", "Display name")
    .option(
      "--workspace-dir <path>",
      "Absolute filesystem path (default: <GLYPH_HOME>/workspaces/<uuid>)",
    )
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await workspaceAdd({
        ...parseConnectFlags(opts),
        name: pickString(opts, "name") ?? "",
        ...optionalString(opts, "workspaceDir"),
      });
    });

  withConnectFlags(workspaceCmd.command("current"))
    .description("Print the current workspace id")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await workspaceCurrent(parseConnectFlags(opts));
    });

  withConnectFlags(workspaceCmd.command("show"))
    .argument("<workspace-id>", "Workspace id")
    .description("Print one workspace's metadata")
    .action(async (workspaceId: string, opts: Record<string, unknown>) => {
      slot.result = await workspaceShow(workspaceId, parseConnectFlags(opts));
    });

  withConnectFlags(workspaceCmd.command("update"))
    .argument("<workspace-id>", "Workspace id")
    .description("Update name")
    .option("--name <name>", "New display name")
    .action(async (workspaceId: string, opts: Record<string, unknown>) => {
      slot.result = await workspaceUpdate(workspaceId, {
        ...parseConnectFlags(opts),
        ...optionalString(opts, "name"),
      });
    });

  withConnectFlags(workspaceCmd.command("rm"))
    .argument("<workspace-id>", "Workspace id")
    .description("Remove a workspace")
    .option("--purge", "Also remove the workspace's glyph-managed subdirs")
    .action(async (workspaceId: string, opts: Record<string, unknown>) => {
      slot.result = await workspaceRm(workspaceId, {
        ...parseConnectFlags(opts),
        purge: opts.purge === true,
      });
    });

  withConnectFlags(workspaceCmd.command("reload"))
    .argument("<workspace-id>", "Workspace id")
    .description("Force the server to rebuild the workspace context")
    .action(async (workspaceId: string, opts: Record<string, unknown>) => {
      slot.result = await workspaceReload(workspaceId, parseConnectFlags(opts));
    });
}
