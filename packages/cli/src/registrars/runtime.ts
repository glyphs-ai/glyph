import type { Command } from "commander";
import { runtimeList } from "../commands/runtime.js";
import { parseConnectFlags, type Slot, withConnectFlags } from "./_shared.js";

export function registerRuntimeCommands(program: Command, slot: Slot): void {
  const runtimeCmd = program.command("runtime").description("Runtime registry operations");
  withConnectFlags(runtimeCmd.command("list"))
    .description("List the registered runtimes")
    .action(async (opts: Record<string, unknown>) => {
      slot.result = await runtimeList(parseConnectFlags(opts));
    });
}
