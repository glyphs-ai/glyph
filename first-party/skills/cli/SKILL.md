---
name: cli
scope: official
description: "Control a glyph server from the CLI — workspaces, agents, tasks, sessions, schedules, catalog, workflows, and server lifecycle"
version: 0.5.0
---

# official/cli skill

You're an AI controlling a glyph server through its CLI. This skill is a **map of the entire `glyph` command surface** plus the conventions that aren't obvious from `--help` — most importantly the workspace-scoping discipline that keeps your commands from racing with other clients, and the exit-code / error-code discipline that lets you branch mechanically on failures.

## Setup

`glyph` injects what you need into your env when it spawns your task or session:

- `GLYPH_SERVER` — server URL (the CLI uses this automatically)
- `GLYPH_WORKSPACE` — workspace UUID (workspace-scoped commands inherit it)

Quick verification:

```sh
glyph health         # exit 0 ⇒ CLI works + server reachable
glyph workspace current --json | jq   # confirm workspace resolved
```

## Command surface at a glance

Every workspace-scoped command inherits `--server / --workspace-id / --output / --json` and follows the shared exit-code table below. The subcommand groups:

| Group | Purpose | Reference |
| --- | --- | --- |
| `workspace` | Create / list / show / update / remove / reload workspaces; print current id | `references/commands.md#workspace` |
| `session` | Manage interactive sessions (list / new / show / rm / spawn a terminal) | `references/commands.md#session` |
| `task` | Dispatch one-shot tasks, list (incl. scoped by `--origin`), inspect them, tail activity, cancel, remove | `references/commands.md#task` |
| `schedule` | Cron-triggered task launchers (create / list / patch / enable / disable / run / preview / list-tasks) | `references/commands.md#schedule` |
| `catalog` | Install / sync / enable / disable agents, skills, MCPs | `references/commands.md#catalog` |
| `workflow` | Seed a workflow, read/mutate its live DAG (expand, patch a not_started node's spec via `update-spec`), respond to human nodes, terminate | `references/commands.md#workflow` |
| `runtime` | List registered runtimes (copilot, etc) | `references/commands.md#runtime` |
| Server inspection | `health`, `config`, `status`, `logs` — no lifecycle | `references/commands.md#server-inspection` |
| Server lifecycle | `serve / start / stop / restart` — **out of scope** for this skill | — |

## Workspace discipline

Every workspace-scoped command requires an explicit selector. The CLI reads `GLYPH_WORKSPACE` from your env (already set), so commands work as-is:

```sh
glyph task dispatch --agent writer --brief "..."
```

To act on a different workspace, pass `--workspace-id <id>` per command:

```sh
glyph task list --workspace-id ws-Y
```

The CLI does not consult any server-side shared "current workspace" state — selectors are process-local, immune to interference from other clients (other CLI sessions, dashboard tabs, AI agents on the same server).

## Output discipline

- **For parsing, always pass `--json`.** Human/table format is not a stable contract — column order and headings change between releases.
- **For streaming activity, pipe through `jq -c`** to keep one event per line.
- Every `--json` shape you're likely to consume is documented in `references/json-shapes.md`. Consult it before writing a `jq` filter — most shapes have optional fields (present when the underlying row is non-null) that you should key off of.

## Error discipline

Errors on stderr always carry a `code`:

```
agent "writer" is not ready: prereqs not acknowledged (HTTP 409, EntryNotReadyError)
  agent: acme/writer
  cause: prereqs not acknowledged
  fix:   glyph catalog agent ack-prereqs acme/writer
```

The `fix:` line is your next command, verbatim. The full `code` catalogue (all error names + typical HTTP + remediation) lives in `references/error-codes.md`. In particular:

- `EntryNotReadyError` is the single most common branch you'll take — it carries a structured `reason` describing whether the agent needs `ack-prereqs`, is `disabled`, has `missingDeps`, or has `blockedDeps` (which recurse). The reason table is in `references/error-codes.md#entrynotreadyerror-reasons`.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | success | continue |
| 1 | generic error (incl. missing workspace) | read stderr; usually missing flag/env |
| 2 | usage error (missing required flag, removed subcommand) | fix the invocation; do **not** retry as-is |
| 3 | server unreachable | ask user to `glyph start` or check `--server` |
| 4 | server returned 4xx/5xx | read `code` in stderr; consult `references/error-codes.md` |

Exit code 2 means **"the command itself is wrong"** — never retry it without changing the invocation. Exit code 4 means "the server rejected this" — read the `code` field, it tells you the next move.

## Pitfalls

- **To wait for a task, use `glyph task activity <tid> --follow`** (real-time SSE). Polling `task list` in a shell loop wastes cycles and lags real events.
- **For a one-shot "what's happened so far?" snapshot, drop `--follow`** — `glyph task activity <tid> --json` returns the current activity plus `totalItems` in one call. `--follow` blocks until the task terminates.
- **Terminate before you remove.** Plain `task rm <tid>` requires the task to be in a terminal state (`succeeded` / `failed` / `cancelled`); if it's still running, `glyph task cancel <tid>` first, then `task rm`. Reach for `--purge` only when you also want the workdir + runtime state gone (post-mortem `stderr.log` is lost). Same distinction on `session rm` and `workspace rm`.
- **Always resume `--follow` with the printed `last seq:`.** On every clean exit (`event: end` or stream closed) AND on mid-stream-error exit, the CLI prints `last seq: <N>` to stderr — pass `--after <N>` on the next `--follow` invocation to resume without gaps or duplicates. Ctrl+C is the exception (stderr is not flushed); derive the seq from the last stdout NDJSON item instead (`... | tail -1 | jq .seq`). Full resume playbook lives in `references/playbooks.md#monitor-a-long-running-task`.
- **Always get workspace ids from `glyph workspace list --json | jq`.** Dashboard URL fragments drift between releases and aren't a wire contract.
- **`schedule patch` is sparse** — only the flags you pass go on the wire. To remove a field, pass `--clear-details` / `--clear-runtime` (an empty `--details ""` is treated as omitted, not as clear).

## References (mandatory reading before non-trivial work)

- `references/commands.md` — per-group subcommand reference (workspace / session / task / schedule / catalog / workflow / runtime / server inspection). Skim once, keep as lookup.
- `references/playbooks.md` — multi-step goal-oriented playbooks (install-and-verify agent, dispatch-and-wait, monitor task, sync entry, clean up, onboard fresh workspace, create a local agent on the fly).
- `references/json-shapes.md` — the common `--json` payload shapes with concrete field lists and optionality notes.
- `references/error-codes.md` — every `code` value the server emits + the matching `glyph` command to fix it.
