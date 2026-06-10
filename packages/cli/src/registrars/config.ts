import type { Command } from "commander";
import { config } from "../commands/config.js";
import { parseConnectFlags, type Slot, withConnectFlags } from "./_shared.js";

export function registerConfigCommands(program: Command, slot: Slot): void {
  withConnectFlags(program.command("config"))
    .description("Print the server's resolved configuration")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await config(parseConnectFlags(opts));
    });
}
