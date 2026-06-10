/**
 * `@glyphs-ai/cli` — top-level entry. Wires up `commander`, registers
 * subcommand registrars, and dispatches.
 *
 * Public surface:
 *  - `run(argv)` — invoke the CLI with a custom argv (handy for tests).
 *    Returns the exit code instead of touching `process.exit`, so tests
 *    can assert on it without aborting the runner.
 *
 * The bin (`./bin.ts`) calls `run(process.argv)` and exits with the
 * returned code.
 *
 * Why commander (not cac): nested subcommands. The CLI ships ~30
 * grouped commands (`workspace list`, `catalog skill install`, …) and
 * cac matches commands by single argv tokens — `cli.command("workspace
 * list", ...)` registers a literal "workspace list" name that nothing
 * can invoke. Commander handles nested `program.command("workspace")
 * .command("list")` natively.
 *
 * Layering: command implementations live in `./commands/*.ts`;
 * commander wiring lives in `./registrars/*.ts`. This file owns only
 * top-level process flow and the `glyph help` shortcut.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import type { Slot } from "./registrars/_shared.js";
import { registerCatalogCommands } from "./registrars/catalog.js";
import { registerConfigCommands } from "./registrars/config.js";
import { registerHealthCommands } from "./registrars/health.js";
import { registerLifecycleCommands } from "./registrars/lifecycle.js";
import { registerRuntimeCommands } from "./registrars/runtime.js";
import { registerScheduleCommands } from "./registrars/schedule.js";
import { registerSessionCommands } from "./registrars/session.js";
import { registerTaskCommands } from "./registrars/task.js";
import { registerWorkflowCommands } from "./registrars/workflow.js";
import { registerWorkspaceCommands } from "./registrars/workspace.js";

/** Exit code for usage / parse errors (POSIX EX_USAGE convention). */
const EX_USAGE = 2;

/**
 * `glyph` CLI entry point. Returns the intended exit code; the bin
 * layer is responsible for `process.exit`. This split lets tests
 * assert on exit codes without aborting the test runner.
 */
export async function run(argv: string[] = process.argv): Promise<number> {
  const slot: Slot = { result: null };
  const program = buildProgram(slot, argv);

  // No-args: print top-level help.
  if (argv.length <= 2) {
    program.outputHelp();
    return 0;
  }

  // `glyph help` / `glyph help <subcommand...>` short-circuits so
  // the caller doesn't have to remember `--help` placement.
  if (argv[2] === "help") {
    if (argv.length === 3) {
      program.outputHelp();
      return 0;
    }
    return run([argv[0] ?? "node", argv[1] ?? "glyph", ...argv.slice(3), "--help"]);
  }

  try {
    await program.parseAsync(argv, { from: "node" });
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander throws for --help, --version, missing required args, etc.
      // help/version are exit 0; everything else collapses to a usage
      // error (commander's own exit codes are inconsistent — `1` for
      // unknown command, `1` for missing required option — so map
      // them all to EX_USAGE for predictable scripting).
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
        return 0;
      }
      return EX_USAGE;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (slot.result) {
    if (slot.result.stdout) process.stdout.write(slot.result.stdout);
    if (slot.result.stderr) process.stderr.write(slot.result.stderr);
    return slot.result.exitCode;
  }
  return 0;
}

/**
 * Build the commander tree. The `slot` parameter is the cross-action
 * sink for {@link CommandResult} payloads — every action assigns to it;
 * the caller emits stdout / stderr / exit code from outside the action
 * so tests can swap the stdio destination.
 */
function buildProgram(slot: Slot, argv: string[]): Command {
  const program = new Command();
  program
    .name("glyph")
    .description("Orchestrate agentic systems built on the MetaAgents format spec")
    .version(readPackageVersion(), "-v, --version", "Print the CLI version")
    .helpOption("-h, --help", "Display this message")
    .showHelpAfterError("(run `glyph help` for usage)")
    .exitOverride();

  registerLifecycleCommands(program, slot);

  program
    .command("help [subcommand...]")
    .description("Show help for glyph or a subcommand")
    .action(async (subcommand: string[] | undefined) => {
      if (!subcommand || subcommand.length === 0) {
        program.outputHelp();
        return;
      }
      await run([argv[0] ?? "node", argv[1] ?? "glyph", ...subcommand, "--help"]);
    });

  registerHealthCommands(program, slot);
  registerConfigCommands(program, slot);
  registerRuntimeCommands(program, slot);
  registerWorkspaceCommands(program, slot);
  registerSessionCommands(program, slot);
  registerScheduleCommands(program, slot);
  registerTaskCommands(program, slot);
  registerWorkflowCommands(program, slot);
  registerCatalogCommands(program, slot);

  return program;
}

/**
 * Best-effort version lookup. Tries:
 *   1. `<this-dir>/../package.json` — bundle layout (`bundle/glyph.js`
 *      → root `package.json` of the published `@glyphs-ai/glyph`).
 *   2. `<this-dir>/../../package.json` — source layout
 *      (`packages/cli/dist/index.js` → `packages/cli/package.json`).
 *
 * Falls back to a placeholder so `glyph --version` never throws.
 */
function readPackageVersion(): string {
  let here: string;
  try {
    here = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return "0.0.0-unknown";
  }
  for (const candidate of [
    path.join(here, "..", "package.json"),
    path.join(here, "..", "..", "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {}
  }
  return "0.0.0-unknown";
}
