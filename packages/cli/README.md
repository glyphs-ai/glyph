# @glyphs-ai/cli

> **Tier:** T_top (Surfaces).

Command-line interface for glyph (lifecycle commands + HTTP API
client).

## Scope

The CLI surface is organized into:

- Server lifecycle commands: `serve` (run in the foreground), `start`
  (spawn detached), `stop`, `restart`, `status`, `logs` (tail the
  rolled server log).
- Unscoped singletons: `health`, `config`.
- A `runtime` subtree: `runtime list` (inspect the runtime registry).
- Workspace-scoped resource subtrees: `workspace`, `session`,
  `schedule`, `task`, `workflow`, `catalog` — each registered from a
  dedicated file under `src/registrars/`. Handler functions for every
  subtree live under `src/commands/`; there is no inline wiring.

Every API-mapping command calls a generated operation from the
`@glyphs-ai/sdk` client (see `sdk-client.ts` for the CLI-side glue).
The operations are typed from the server's OpenAPI spec, so a typo or
stale request shape fails to compile rather than 404-ing at runtime.

## Layout

```
packages/cli/src/
  bin.ts            Bundled binary entry: calls `run(process.argv)` and exits.
  index.ts          Exports `run(argv)`; builds the commander tree.
  commands/         Handler functions invoked by the commander tree --
                    one file per top-level command or group. The three
                    largest groups are split facade + sibling subdir
                    (`catalog.ts` + `catalog/`, `schedule.ts` +
                    `schedule/`, `workflow.ts` + `workflow/`); the
                    facade re-exports its concern modules and is the
                    only import surface.
  registrars/       Commander subtree builders — one per top-level
                    command or group: `lifecycle` (serve / start / stop /
                    restart / status / logs), `config`, `health`,
                    `runtime`, and the six workspace-scoped subtrees
                    (`workspace`, `session`, `schedule`, `task`,
                    `workflow`, `catalog`) — plus `_shared.ts`
                    (connect / workspace flag parsing + helpers).
  sdk-client.ts     CLI-side glue over the `@glyphs-ai/sdk` client.
  connect.ts        Resolve `baseUrl` + `workspaceId` from flags, env,
                    and `<GLYPH_HOME>/runtime.json`.
  health-probe.ts   Poll `/api/health` (used by `start` and `status`).
  server-bundle.ts  Locate the bundled CLI/server entry that `start`
                    spawns as a detached child.
  runtime-file.ts   Atomic read / write / delete of
                    `<GLYPH_HOME>/runtime.json` (the lifecycle breadcrumb).
  log-paths.ts      Resolve the latest rolled `pino-roll` server log.
  output.ts         Table / record / JSON formatters and error mapping.
  result.ts         `CommandResult` shape returned by every command.
```

## Naming conventions

Every workspace-scoped command in the CLI obeys one fixed shape for
identifiers. The rules are non-negotiable; reviewers reject PRs that
add a flag or argument outside this table.

### Resource ids

The id of the resource a subcommand acts on is always a **positional
argument** named after the resource, kebab-cased:

| Subcommand family       | Positional argument |
| ----------------------- | ------------------- |
| `workspace <verb> …`    | `<workspace-id>`    |
| `session <verb> …`      | `<session-id>`      |
| `schedule <verb> …`     | `<schedule-id>`     |
| `task <verb> …`         | `<task-id>`         |
| `workflow <verb> …`     | `<workflow-id>`     |

A subcommand that targets a nested resource (e.g. a node within a
workflow) takes the parent positional first, then the nested positional:

```
glyph workflow node-show     <workflow-id> <node-id>
glyph workflow remove-node   <workflow-id> <node-id>
glyph workflow replace-spec  <workflow-id> <node-id> --spec-file <path>
glyph workflow cancel-node   <workflow-id> <node-id>
glyph workflow respond       <workflow-id> <node-id>
```

### Secondary id flags

When a subcommand needs additional ids that don't fit as positionals
(typically endpoints of an edge), each is a `--<resource>-<id>`-suffixed
long flag — kebab-case, fully spelled out, no short alias, no
abbreviation:

```
glyph workflow add-edge      <workflow-id> --from-node-id <id> --to-node-id <id>
glyph workflow remove-edge   <workflow-id> --from-node-id <id> --to-node-id <id>
```

A flag that accepts a comma-separated list of ids uses the plural
`<resource>-<id>s` form:

```
glyph workflow add-node      <workflow-id> --kind <k> --spec-file <p> --parent-node-ids <id1,id2>
```

### Cross-cutting workspace selector

The single cross-cutting flag is `-w, --workspace-id <id>` (with `-w`
as the short alias for interactive use). The same env var
`GLYPH_WORKSPACE` is the secondary source; flag wins over env. Every
workspace-scoped command gets this flag automatically via
`withWorkspaceFlags(...)` in `src/registrars/_shared.ts`. Authors do
not redeclare it per command.

### Prohibited shapes

The following are forbidden — Commander rejects them at parse time
when used, and dedicated tests in
[`test/commands/workflow.test.ts`](test/commands/workflow.test.ts)
assert they keep being rejected:

- Abbreviated id flags: `--wfid`, `--nid`, `--tid`, `--sid` (and any
  other concatenated abbreviation).
- The bare workspace flag `--workspace` (the canonical spelling is
  `--workspace-id`).
- Generic positional placeholders like `<id>` (always name the
  resource: `<workspace-id>`, `<workflow-id>`, etc.).
- Singular flag spelling for a csv-of-ids flag (e.g. `--parent-node-id`
  for a comma-separated list).

### How to add a new flag

Before adding a new id-bearing flag or argument to any subcommand,
check three things:

1. Is it the id of the subcommand's primary resource? → positional,
   named after the resource (`<thing-id>`).
2. Is it the id of a sibling resource referenced from the call (edge
   endpoint, parent, target)? → `--<resource>-id <id>` long flag.
3. Is it a list of ids? → `--<resource>-ids <id1,id2,...>` long flag
   (csv plural).

If the answer is "none of the above", you're outside the convention —
discuss with maintainers before adding the flag.

## Public API

```ts
import { run } from "@glyphs-ai/cli";

const code = await run(["node", "glyph", "status", "--json"]);
process.exit(code);
```

`run(argv: string[]): Promise<number>` is the only exported entry. It
returns the intended exit code instead of calling `process.exit` so
tests can assert on exit codes without aborting the runner. The bin
(`src/bin.ts`) is a two-line wrapper that calls `run(process.argv)`
and exits.

There is no `bin` field in `package.json`. The per-package CLI is not
the install pattern; users install the bundled `@glyphs-ai/glyph`
package, whose root `bin.glyph` points at `bundle/glyph.js` (the
file produced by `esbuild.config.js` with both CLI and server
inlined).

## Why commander

The CLI ships many grouped commands across the resource subtrees
(workspace, session, task, workflow, catalog, schedule, runtime, plus
lifecycle and singleton commands) — each wrapping a server route via
the generated typed operations from `@glyphs-ai/sdk` (`workspace list`,
`catalog skill install`, ...). `cac` matches commands by single argv
tokens, so `cli.command("workspace list", ...)` would register a
literal `"workspace list"` name that nothing can invoke. Commander
handles nested `program.command("workspace").command("list")`
natively, so the whole tree is composable per resource. Full
rationale: the JSDoc at the top of `src/index.ts`.

## Server connection

The CLI talks to a server it does NOT host. `src/connect.ts` resolves
the base URL and workspace id with the following precedence (top
wins):

1. Explicit CLI flags: `--server <url>`, `-w, --workspace-id <id>`.
2. Environment: `GLYPH_SERVER`, `GLYPH_WORKSPACE`.
3. `<GLYPH_HOME>/runtime.json` (host + port written by a recent
   `glyph start`) — applies to the URL only; the workspace id has
   no on-disk fallback by design.
4. Hard default: `http://127.0.0.1:8787`.

The shared connect-flag bundle (`--server`, `--output`, `--json`) is
appended to every API command by `withConnectFlags`; workspace-scoped
commands additionally take `-w, --workspace-id <id>` via
`withWorkspaceFlags`. See [`src/registrars/_shared.ts`](src/registrars/_shared.ts).

Lifecycle commands that bind a local server (`serve`, `start`,
`restart`) take their own `--host` and `--port` flags (defaults
`127.0.0.1` and `8787`); those are bind flags on the server process,
not connect flags on the client.

`<GLYPH_HOME>` — referenced above and in the paths throughout this
section — is the on-disk anchor for lifecycle state. It defaults to
`~/.glyph` and is set by the `GLYPH_HOME` environment variable. It
determines where `runtime.json` and the rolled server logs (`logs/`)
are written by `glyph start` and read back by `serve`, `start`, `stop`,
`restart`, `status`, and `logs` — the same `runtime.json` the
URL-resolution fallback (step 3 above) depends on.

## Testing

```sh
pnpm --filter @glyphs-ai/cli test
```

Unit + integration suites mock HTTP at the `fetch` boundary. Cross-
package end-to-end smoke tests that spawn a real CLI process live in
[`packages/e2e/test/cli/integration-smoke.test.ts`](../e2e/test/cli/integration-smoke.test.ts)
and [`packages/e2e/test/cli/spawn-smoke.test.ts`](../e2e/test/cli/spawn-smoke.test.ts).

Known flake: `runtime-file > write is atomic` occasionally fails with
`EPERM` on Windows under contention (Windows refuses `unlink` while
another handle holds the target); it does not reproduce on Linux/macOS.

## Tier

Top-level surface tier alongside `@glyphs-ai/dashboard`. Depends on
`@glyphs-ai/sdk` (generated client + wire DTOs) and
`@glyphs-ai/server` (for the bundled embed path and the shared
`runtime.json` shape). It does NOT import any other package; the
tier-invisibility fence is enforced by
`packages/e2e/test/architecture/tier-invisibility.test.ts`.
