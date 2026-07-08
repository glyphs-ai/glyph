/**
 * Snapshot of the user-facing CLI help surface: `glyph --help` plus the
 * top-level subcommand `--help`s.
 *
 * Downstream automation (CI pipelines, agent tooling) and the
 * registrars' own ordering comments depend on the exact command and
 * flag names and their order; a rename, dropped subcommand, or
 * description rewrite shows up here as a snapshot diff in code review.
 * The existing CLI suites only assert exit codes and `--json` happy
 * paths, so the human-facing surface itself was unpinned.
 *
 * ANSI escapes and any embedded semver are stripped before snapshotting
 * so the snapshot is colour- and version-stable. The spawn pipes
 * stdout, so commander renders at its non-TTY default width and the
 * output does not depend on the runner's terminal columns.
 *
 * Skips when the CLI bundle (`packages/cli/dist/bin.js`) is absent.
 */

import { describe, expect, it } from "vitest";
import { BIN_AVAILABLE, runBin, SCRUBBED_ENV } from "../_helpers/cli-bundle.js";

// Build the ESC (0x1b) at runtime so no literal control character appears
// in source (biome's noControlCharactersInRegex). Matches CSI SGR colour
// sequences like ESC[1m / ESC[0m.
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

async function help(args: readonly string[]): Promise<string> {
  const res = await runBin([...args, "--help"], SCRUBBED_ENV);
  expect(res.exitCode, res.stderr).toBe(0);
  return res.stdout
    .replace(ANSI_SGR, "")
    .replace(/\b\d+\.\d+\.\d+\b/g, "x.y.z")
    .trimEnd();
}

describe.skipIf(!BIN_AVAILABLE)("CLI help surface", () => {
  it("glyph --help", async () => {
    expect(await help([])).toMatchInlineSnapshot(`
      "Usage: glyph [options] [command]

      Orchestrate agentic systems built on the MetaAgents format spec

      Options:
        -v, --version         Print the CLI version
        -h, --help            Display this message

      Commands:
        serve [options]       Run the glyph server in the foreground
        start [options]       Start the glyph server as a detached background process
        stop                  Stop a running glyph server
        restart [options]     Stop and start the glyph server
        status [options]      Print whether the glyph server is running
        logs [options]        Print the server log file
        help [subcommand...]  Show help for glyph or a subcommand
        health [options]      Probe the server's /api/health endpoint
        config [options]      Print the server's resolved configuration
        runtime               Runtime registry operations
        workspace             Workspace operations
        session               Session operations (workspace-scoped)
        schedule              Schedule operations (workspace-scoped cron triggers)
        task                  Task operations (workspace-scoped)
        workflow              Workflow operations (workspace-scoped DAG runs)
        catalog               Catalog operations (workspace-scoped)"
    `);
  });

  it("glyph start --help", async () => {
    expect(await help(["start"])).toMatchInlineSnapshot(`
      "Usage: glyph start [options]

      Start the glyph server as a detached background process

      Options:
        -p, --port <port>    Listen port (env: PORT, default 8787)
        --host <host>        Bind host (env: GLYPH_HOST, default x.y.z.1)
        --no-serve-static    Do not serve the dashboard SPA
        --static-dir <dir>   Override the dashboard SPA directory
        --log-level <level>  Log level (debug | info | warn | error)
        --log-format <fmt>   Log format on stdout (pretty | json)
        -h, --help           Display this message"
    `);
  });

  it("glyph stop --help", async () => {
    expect(await help(["stop"])).toMatchInlineSnapshot(`
      "Usage: glyph stop [options]

      Stop a running glyph server

      Options:
        -h, --help  Display this message"
    `);
  });

  it("glyph status --help", async () => {
    expect(await help(["status"])).toMatchInlineSnapshot(`
      "Usage: glyph status [options]

      Print whether the glyph server is running

      Options:
        --json      Emit a JSON payload instead of a one-line summary
        -h, --help  Display this message"
    `);
  });

  it("glyph health --help", async () => {
    expect(await help(["health"])).toMatchInlineSnapshot(`
      "Usage: glyph health [options]

      Probe the server's /api/health endpoint

      Options:
        --server <url>  Server URL (env: GLYPH_SERVER, runtime.json)
        --output <fmt>  Output format: table | json
        --json          Shorthand for --output json
        -h, --help      Display this message"
    `);
  });

  it("glyph config --help", async () => {
    expect(await help(["config"])).toMatchInlineSnapshot(`
      "Usage: glyph config [options]

      Print the server's resolved configuration

      Options:
        --server <url>  Server URL (env: GLYPH_SERVER, runtime.json)
        --output <fmt>  Output format: table | json
        --json          Shorthand for --output json
        -h, --help      Display this message"
    `);
  });

  it("glyph runtime --help", async () => {
    expect(await help(["runtime"])).toMatchInlineSnapshot(`
      "Usage: glyph runtime [options] [command]

      Runtime registry operations

      Options:
        -h, --help      Display this message

      Commands:
        list [options]  List the registered runtimes
        help [command]  display help for command"
    `);
  });

  it("glyph workspace --help", async () => {
    expect(await help(["workspace"])).toMatchInlineSnapshot(`
      "Usage: glyph workspace [options] [command]

      Workspace operations

      Options:
        -h, --help                       Display this message

      Commands:
        list [options]                   List all workspaces
        add [options]                    Create a new workspace
        current [options]                Print the current workspace id
        show [options] <workspace-id>    Print one workspace's metadata
        update [options] <workspace-id>  Update name
        rm [options] <workspace-id>      Remove a workspace
        reload [options] <workspace-id>  Force the server to rebuild the workspace
                                         context
        help [command]                   display help for command"
    `);
  });

  it("glyph session --help", async () => {
    expect(await help(["session"])).toMatchInlineSnapshot(`
      "Usage: glyph session [options] [command]

      Session operations (workspace-scoped)

      Options:
        -h, --help                    Display this message

      Commands:
        list [options]                List sessions in the current workspace
        new [options]                 Create a new session
        show [options] <session-id>   Print one session's metadata
        rm [options] <session-id>     Remove a session
        spawn [options] <session-id>  Spawn a terminal for the session
        help [command]                display help for command"
    `);
  });

  it("glyph schedule --help", async () => {
    expect(await help(["schedule"])).toMatchInlineSnapshot(`
      "Usage: glyph schedule [options] [command]

      Schedule operations (workspace-scoped cron triggers)

      Options:
        -h, --help                              Display this message

      Commands:
        list [options]                          List schedules in the current workspace
        create [options]                        Create a new schedule
        create-workflow [options]               Create a new workflow-kind schedule
        show [options] <schedule-id>            Print one schedule's metadata
        enable [options] <schedule-id>          Enable a schedule (re-arms the timer)
        disable [options] <schedule-id>         Disable a schedule (cancels timer; in-flight tasks unaffected)
        patch [options] <schedule-id>           Partially update a schedule (any subset of name / cron / tz / agent / brief / details / clear-details / runtime / clear-runtime / enabled)
        patch-workflow [options] <schedule-id>  Partially update a workflow-kind schedule (any subset of name / cron / tz / coord-agent / brief / details / clear-details / enabled)
        rm [options] <schedule-id>              Delete a schedule (refuses if enabled or has in-flight tasks)
        run [options] <schedule-id>             Fire a schedule now (out-of-band; does not advance the cron cursor)
        preview [options] <schedule-id>         Show next fire times + cron description
        list-tasks [options]                    List tasks launched by this workspace's schedules
        list-workflows [options]                List workflows launched by this workspace's schedules
        help [command]                          display help for command"
    `);
  });

  it("glyph task --help", async () => {
    expect(await help(["task"])).toMatchInlineSnapshot(`
      "Usage: glyph task [options] [command]

      Task operations (workspace-scoped)

      Options:
        -h, --help                    Display this message

      Commands:
        list [options]                List standalone tasks in the current workspace
                                      (or an origin's tasks with
                                      --origin/--origin-id)
        dispatch [options]            Dispatch a new task
        show [options] <task-id>      Print one task's metadata
        rm [options] <task-id>        Remove a task. Requires task to be in a
                                      terminal state. Use 'task cancel' first if
                                      still running.
        cancel [options] <task-id>    Cancel a running task. Sends SIGTERM and marks
                                      cancelled. Use 'task rm' afterward to also
                                      delete the record.
        activity [options] <task-id>  Print the runtime-parsed activity timeline
                                      (JSON)
        help [command]                display help for command"
    `);
  });

  it("glyph workflow --help", async () => {
    expect(await help(["workflow"])).toMatchInlineSnapshot(`
      "Usage: glyph workflow [options] [command]

      Workflow operations (workspace-scoped DAG runs)

      Options:
        -h, --help                                     Display this message

      Commands:
        list [options]                                 List workflows in the current workspace
        create [options]                               Seed a new workflow + its initial coordinator node
        show [options] <workflow-id>                   Print one workflow's header (status, iterationCount, timestamps)
        node-show [options] <workflow-id> <node-id>    Print one workflow node's projected wire shape
        dag [options] <workflow-id>                    Print the full DAG snapshot (header + nodes + edges)
        cancel [options] <workflow-id>                 Cancel a running workflow (flips status → cancelled, reconciles non-terminal nodes)
        rm [options] <workflow-id>                     Remove a terminal workflow
        add-node [options] <workflow-id>               Coord-only: insert one node attached to one or more existing parents
        add-subgraph [options] <workflow-id>           Coord-only: insert N nodes + intra-batch edges atomically
        prune-subgraph [options] <workflow-id>         Coord-only: retract N not-started nodes + their adjacent edges atomically
        update-spec [options] <workflow-id> <node-id>  Coord-only: patch a not-started worker/human node's spec (partial, whitelisted)
        add-edge [options] <workflow-id>               Coord-only: add a single edge between two existing nodes
        cancel-node [options] <workflow-id> <node-id>  Coord-only: cancel a single worker node (coord-kind targets are rejected with 409)
        finish [options] <workflow-id>                 Coord-only: flip the workflow terminal (outcome: succeeded | failed)
        respond [options] <workflow-id> <node-id>      Respond to a human-kind node that is waiting for input
        help [command]                                 display help for command"
    `);
  });

  it("glyph catalog --help", async () => {
    expect(await help(["catalog"])).toMatchInlineSnapshot(`
      "Usage: glyph catalog [options] [command]

      Catalog operations (workspace-scoped)

      Options:
        -h, --help          Display this message

      Commands:
        overview [options]  Per-workspace catalog counts
        skill               Skill operations
        agent               Agent operations
        mcp                 MCP operations
        help [command]      display help for command"
    `);
  });
});
