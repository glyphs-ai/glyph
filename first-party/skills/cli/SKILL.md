---
name: cli
scope: official
description: "Control a glyph server from the CLI — workspaces, agents, tasks, sessions, schedules, catalog, workflows, and server lifecycle"
version: 0.3.0
---

# official/cli skill

You're an AI controlling a glyph server through its CLI. This skill is a **map of the entire `glyph` command surface** plus the conventions that aren't obvious from `--help` — most importantly the workspace-scoping discipline that keeps your commands from racing with other clients, and the exit-code / error-code discipline that lets you branch mechanically on failures.

## When to use

- Anything that touches a glyph server: workspaces, agents, skills, MCPs, tasks, sessions, schedules, workflows
- Reading a task/workflow's live activity or resuming a stream after a disconnect
- Server-lifecycle inspection (health, config, logs, status) — NOT server admin (`glyph start / stop / restart / serve`) which is out of scope

If the user just wants you to read repo files or run generic shell commands, this skill is irrelevant.

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
| `task` | Dispatch one-shot tasks, inspect them, tail activity, cancel, remove | `references/commands.md#task` |
| `schedule` | Cron-triggered task launchers (create / list / patch / enable / disable / run / preview / list-tasks) | `references/commands.md#schedule` |
| `catalog` | Install / sync / enable / disable agents, skills, MCPs | `references/commands.md#catalog` |
| `workflow` | Seed a DAG run, walk it, mutate it as coord, respond to human nodes | `references/commands.md#workflow` |
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

## Anti-patterns

- **Don't poll without backoff.** `while true; do glyph task list; done` is wrong. To wait for a task, use `glyph task activity <tid> --follow` (real-time SSE) instead of polling `task list`.
- **Don't use `--follow` for one-shot data.** `--follow` blocks until the task terminates. For "what's the latest activity right now?" use `glyph task activity <tid>` (no `--follow`) and read the JSON.
- **Don't `--purge` casually.** Default `task rm` (no flag) removes the metadata row only — and **requires the task to be in a terminal state** (`succeeded` / `failed` / `cancelled`); it does NOT cancel a running task. If the task is still running, use `glyph task cancel <tid>` first, then `task rm`. `task rm --purge` additionally removes the task workdir and the runtime's per-task state on disk — use only after you're sure you don't need the post-mortem material (`stderr.log`, etc). Same distinction applies to `session rm` and `workspace rm`.
- **Don't ignore `last seq:` on stderr** when streaming. On every clean `--follow` exit (`event: end` from the server, or stream closed) AND on mid-stream-error exit, the CLI prints `last seq: <N>` to stderr — pass `--after <N>` to the next `--follow` invocation to resume without gaps or duplicates. **Caveat:** Ctrl+C kills the process between frames and stderr is not flushed; recover the seq from stdout in that case (`... | tail -1 | jq .seq`) since each printed item carries its own `seq`.
- **Don't construct workspace ids from the dashboard URL.** Always `glyph workspace list --json | jq` to get a current id.
- **Don't `schedule patch` without diffing first.** The CLI-side patch is sparse: only the flags you pass go on the wire. Pair `--clear-details` / `--clear-runtime` with an absent `--details` / `--runtime` to remove a field; don't rely on `--details ""` (which is treated as omitted).

## Common SSE resume pattern

`glyph task activity` is the one command with real streaming semantics. Same skeleton applies to any `--follow` invocation the CLI grows in future.

```sh
# History-then-tail (combines snapshot with live).
# The one-shot response is tail-first, so the LAST item in the
# returned `activity` array is the latest seq we've seen — that
# becomes the resume point.
N=$(glyph task activity <tid> --json | jq -r '.activity[-1].seq')
glyph task activity <tid> --follow --after "$N" | jq -c

# Resume after a clean --follow exit (server sent event: end, or
# stream closed). stderr's last line on either of those is `last seq: <N>`.
glyph task activity <tid> --follow --after <N> | jq -c

# Resume after Ctrl+C — stderr was not flushed, so derive the last
# seq from stdout instead. Each NDJSON line carries its own seq.
N=$(printf '%s\n' "$LAST_STDOUT_LINE" | jq -r .seq)
glyph task activity <tid> --follow --after "$N" | jq -c
```

## What this skill is NOT

- **Not a substitute for `--help`.** Concrete flag lists and new subcommands change with releases; consult `glyph <cmd> --help` for the canonical surface. This skill documents the *conventions and shapes* that persist across releases.
- **Not a server admin guide.** This skill assumes the server is running and configured. Service lifecycle (`glyph start / stop / restart / serve`) is a separate concern.

## References (mandatory reading before non-trivial work)

- `references/commands.md` — per-group subcommand reference (workspace / session / task / schedule / catalog / runtime / server inspection). Skim once, keep as lookup.
- `references/playbooks.md` — multi-step goal-oriented playbooks (install-and-verify agent, dispatch-and-wait, monitor task, sync entry, clean up, onboard fresh workspace, create a local agent on the fly).
- `references/json-shapes.md` — the common `--json` payload shapes with concrete field lists and optionality notes.
- `references/error-codes.md` — every `code` value the server emits + the matching `glyph` command to fix it.
