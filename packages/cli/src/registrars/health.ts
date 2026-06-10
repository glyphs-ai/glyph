import type { Command } from "commander";
import { health } from "../commands/health.js";
import { parseConnectFlags, type Slot, withConnectFlags } from "./_shared.js";

export function registerHealthCommands(program: Command, slot: Slot): void {
  withConnectFlags(program.command("health"))
    .description("Probe the server's /api/health endpoint")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await health(parseConnectFlags(opts));
    });
}
