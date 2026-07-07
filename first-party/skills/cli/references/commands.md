# CLI command reference (non-workflow surface)

Per-group subcommand reference for `glyph workspace / session / task / schedule / catalog / runtime` plus server-inspection commands. Workflow lives separately in [`workflow-commands.md`](./workflow-commands.md); JSON payload shapes live in [`json-shapes.md`](./json-shapes.md); error codes in [`error-codes.md`](./error-codes.md).

> All examples assume `GLYPH_WORKSPACE=<id>` is set unless noted. Pass `--workspace-id <id>` to act on a different workspace.
>
> Every workspace-scoped command below accepts the common flags `--server <url> / --output <fmt> / --json / --workspace-id <id>`. Per-command sections only list **additional** flags.

---

## Subcommand index

| Group | Subcommands |
| --- | --- |
| [`workspace`](#workspace) | `list`, `add`, `current`, `show`, `update`, `rm`, `reload` |
| [`session`](#session) | `list`, `new`, `show`, `rm`, `spawn` |
| [`task`](#task) | `list`, `dispatch`, `show`, `activity`, `cancel`, `rm` |
| [`schedule`](#schedule) | `list`, `create`, `show`, `enable`, `disable`, `patch`, `rm`, `run`, `preview`, `list-tasks` |
| [`catalog`](#catalog) | `overview`, `agent {…}`, `skill {…}`, `mcp {…}` |
| [`runtime`](#runtime) | `list` |
| [Server inspection](#server-inspection) | `health`, `config`, `status`, `logs` |

---

## workspace

`glyph workspace <sub>` — manage workspaces (long-lived containers that own their own catalog, sessions, tasks, schedules, workflows). Not `--workspace-id`-scoped except where noted.

### `workspace list`

- Route: `GET /workspaces`
- Output: `Workspace[]` (see [json-shapes.md#workspace](./json-shapes.md#workspace))
- Use: get the id catalogue. Never derive an id from the dashboard URL.

### `workspace add`

- Optional flags: `--name <name>`, `--workspace-dir <abs-path>` (default `<GLYPH_HOME>/workspaces/<uuid>`)
- Route: `POST /workspaces`
- Body: `{ name?, workspaceDir? }`
- Output: `Workspace`
- Failure modes: `WorkspaceAlreadyExistsError` (409, name/workdir clash), `WorkspacePathConflictError` (409, another workspace already on that workdir), `WorkspaceNameInvalidError` (400)

### `workspace current`

- Route: none (reads `GLYPH_WORKSPACE`)
- Output: `{ id }` in JSON mode, or bare id in table mode
- Exit 1 if the env var is unset

### `workspace show <id>`

- Route: `GET /workspaces/:id`
- Output: `Workspace`

### `workspace update <id>`

- Optional flags: `--name <name>` (only field currently updatable)
- Route: `PATCH /workspaces/:id`
- Body: `{ name? }`
- Output: `Workspace`

### `workspace rm <id>`

- Optional flags: `--purge` — additionally remove the workspace's glyph-managed subdirs (workdir stays; only the `sessions/`, `tasks/`, `workflows/`, `catalog/`, `logs/` glyph state is deleted)
- Route: `DELETE /workspaces/:id[?purge=1]`
- Refuses (409, `WorkspaceHasLiveTasksError`) if the workspace has running tasks. Cancel/wait for them first.

### `workspace reload <id>`

- Route: `POST /workspaces/:id/reload`
- Forces the server to rebuild the workspace context (re-scan catalog, re-hydrate registries). Same refusal on live tasks as `rm`.

---

## session

`glyph session <sub>` — long-running conversational sessions. Distinct from tasks: sessions accept multiple turns and are typically driven from a terminal.

### `session list`

- Optional filters: `--agent <name>`, `--created-since <iso>`, `--active-since <iso>`
- Route: `GET /workspaces/:id/sessions`
- Output: `Session[]` (see [json-shapes.md#session](./json-shapes.md#session))

### `session new`

- Optional flags: `--agent <name>` (bake an agent into the session), `--runtime <kind>` (default `copilot`)
- Route: `POST /workspaces/:id/sessions`
- Body: `{ agent?, runtime? }`
- Output: `Session`

### `session show <session-id>`

- Route: `GET /workspaces/:id/sessions/:sid`
- Output: `Session`

### `session rm <session-id>`

- Optional flags: `--purge` — hard delete (also rm the session workdir + runtime's per-session state). Default is archive (row only, workdir left in place for post-mortem).
- Route: `DELETE /workspaces/:id/sessions/:sid[?purge=1]`

### `session spawn <session-id>`

- Optional flags: `--remote` — build a remote-launch command instead of local
- Route: `POST /workspaces/:id/sessions/:sid/spawn`
- Output: `{ command, workdir, env }` — the local mode returns the exact `glyph session attach …` (or runtime-equivalent) command you'd run in a terminal.

---

## task

`glyph task <sub>` — one-shot task dispatches. Every task is owned by exactly one origin (`standalone`, `schedule:<sid>`, or `workflow:<wfid>`) and has a linear terminal state.

### `task list`

- Optional filters: `--agent <name>`, `--runtime <kind>`, `--created-since <iso>`, `--status <csv>` (subset of `running,succeeded,failed,cancelled`)
- Route: `GET /workspaces/:id/tasks`
- Output: `Task[]` (see [json-shapes.md#task](./json-shapes.md#task))
- Note: list is standalone-origin only. Schedule-origin tasks are under `schedule list-tasks`; workflow-origin tasks are surfaced through `workflow dag` / `workflow node-show`.

### `task dispatch`

- Required flags: `--agent <name>`, `--brief <text>` (≤ 200 chars)
- Optional flags: `--details <text>` (multi-line body; `""` is treated as omitted), `--details-file <path>` (mutually exclusive with `--details`), `--runtime <kind>` (default `copilot`)
- Route: `POST /workspaces/:id/tasks`
- Body: `{ agent, brief, details?, runtime? }`
- Output: `Task` (with `status: "running"`)
- Common failures: `EntryNotReadyError` (409, agent blocked — see [error-codes.md#entrynotreadyerror-reasons](./error-codes.md#entrynotreadyerror-reasons)), `AgentNotFound` (404), `RuntimeDoesNotSupportTasksError` (400)

### `task show <task-id>`

- Route: `GET /workspaces/:id/tasks/:tid`
- Output: `Task` (canonical shape; use over `task list` when you need a single row by id)

### `task activity <task-id>`

- Optional flags:
  - `-f, --follow` — tail live activity over SSE; exits when task terminates
  - `--before <seq>` — backward pagination (items with `seq < before`); mutually exclusive with `--after` and `--follow`
  - `--after <seq>` — forward pagination (items with `seq > after`). With `--follow`, sent as `Last-Event-ID` for resume.
  - `--limit <n>` — max items per page (default 50, max 500); ignored under `--follow`
- Route: `GET /workspaces/:id/tasks/:tid/activity` (or SSE `?follow=1`)
- One-shot output: `{ activity: ActivityItem[], result: TerminalResult?, totalItems, truncated? }`. `activity` is tail-first ordering (oldest → newest by `seq`). Derive `hasOlder` from `activity[0].seq > 0` and `hasNewer` from `activity[-1].seq < totalItems - 1`. See [json-shapes.md#activityitem](./json-shapes.md#activityitem) for item shape.
- `--follow` output: NDJSON stream of `ActivityItem`s on stdout; on any exit path (except Ctrl+C) stderr's last line is `last seq: <N>` — pass as `--after <N>` to resume.
- Ctrl+C exception: recover the resume seq from stdout's last NDJSON line (`tail -1 | jq .seq`).

### `task cancel <task-id>`

- Route: `POST /workspaces/:id/tasks/:tid/cancel`
- Sends SIGTERM to the runtime subprocess and marks the task `cancelled`. Non-idempotent on a terminal task (returns 409). Follow with `task rm` if you want the row gone too.

### `task rm <task-id>`

- Optional flags: `--purge` — hard delete (also rm the task workdir + runtime's per-task state)
- Route: `DELETE /workspaces/:id/tasks/:tid[?purge=1]`
- **Requires the task to be in a terminal state** (`succeeded` / `failed` / `cancelled`). Use `task cancel` first if it's still running.

---

## schedule

`glyph schedule <sub>` — cron-driven task launchers scoped to the workspace. Each schedule has a `trigger` (cron expression + IANA tz) and a `target` (task or workflow shape) that gets dispatched on fire. All examples cover the task-target variant; the workflow-target variant only differs in the `target.kind` field.

### `schedule list`

- Optional filters: `--agent <fqn>`, `--enabled <bool>` (`"true"` | `"false"`)
- Route: `GET /workspaces/:id/schedules`
- Output: `Schedule[]` (see [json-shapes.md#schedule](./json-shapes.md#schedule))

### `schedule create`

- Required flags: `--name <text>`, `--agent <fqn>`, `--brief <text>`, `--cron <expr>` (5-field), `--tz <iana>`
- Optional flags: `--details <text>` (mirrors `task dispatch --details`), `--runtime <kind>` (default `copilot`), `--disabled` (create disabled; default is enabled)
- Route: `POST /workspaces/:id/schedules`
- Body: `{ name, trigger: { cron, tz }, target: { kind: "task", agent, brief, details?, runtime? }, enabled }`
- Output: `Schedule`
- Failure: `BadRequest` (400) for invalid cron / tz strings

### `schedule show <schedule-id>`

- Route: `GET /workspaces/:id/schedules/:sid`
- Output: `Schedule`

### `schedule enable <schedule-id>` / `schedule disable <schedule-id>`

- Routes: `POST /workspaces/:id/schedules/:sid/enable` / `.../disable`
- Enable re-arms the timer (server recomputes the next fire relative to now). Disable cancels the timer only — **in-flight tasks are unaffected** (they run to terminal on their own).
- Equivalent shorthands live on `schedule patch --enabled` / `--no-enabled`.

### `schedule patch <schedule-id>`

- Optional flags (any subset): `--name <text>`, `--cron <expr>` (5/6/7-field), `--tz <iana>`, `--agent <fqn>`, `--brief <text>`, `--details <text>`, `--clear-details`, `--runtime <kind>`, `--clear-runtime`, `--enabled` / `--no-enabled`
- Route: `PATCH /workspaces/:id/schedules/task/:sid` (the URL is discriminated by target kind — the CLI derives it from the schedule row)
- Body: sparse JSON — only the flags you passed. `target` is deep-merged server-side: string sets a field, `null` deletes it (`details` / `runtime`), absent keeps existing. `trigger` is wholesale-replace (if you pass only `--cron` OR only `--tz`, the CLI GETs first to fill the other field).
- Output: `Schedule`
- Note: `--details ""` is treated as omitted (does NOT clear). Use `--clear-details` explicitly.

### `schedule rm <schedule-id>`

- Route: `DELETE /workspaces/:id/schedules/:sid`
- Refuses (409) if the schedule is enabled or has in-flight tasks. Disable + cancel first.

### `schedule run <schedule-id>`

- Route: `POST /workspaces/:id/schedules/:sid/run`
- Fires the schedule **out-of-band** — does NOT advance the cron cursor. Useful for manual re-runs / smoke tests. Returns the dispatched task's `Task`.

### `schedule preview <schedule-id>`

- Optional flags: `-n <count>` — number of upcoming fires to compute (1..100, default probably 10; check `--help`)
- Route: `GET /workspaces/:id/schedules/:sid/preview[?n=N]`
- Output: `{ describe: string, nextRuns: string[] }` — `describe` is a human-readable summary of the cron expr (e.g. `"At 09:00 on every day"`); `nextRuns` are ISO 8601 timestamps in the schedule's tz.

### `schedule list-tasks`

- Optional filters: `--schedule-id <id>`, `--agent <fqn>`, `--runtime <kind>`, `--created-since <iso>`, `--status <csv>`
- Route: `GET /workspaces/:id/schedules/list-tasks`
- Output: `Task[]` — same shape as `task list`, but scoped to schedule-origin tasks (`origin` is `schedule:<sid>`)

---

## catalog

`glyph catalog <sub>` — workspace-scoped registry of agents, skills, and MCPs. Every entry has an origin (git URL or `file:` path), a version, and a status.

### `catalog overview`

- Route: `GET /workspaces/:id/catalog/overview`
- Output: `{ counts: { skills, agents, mcps, blocked, orphaned } }`

### Agent, skill, MCP shared shape

All three groups (`catalog agent`, `catalog skill`, `catalog mcp`) share the same subcommand skeleton:

| Subcommand | Route | Purpose |
| --- | --- | --- |
| `list` | `GET /workspaces/:id/catalog/{agents,skills,mcps}` | List installed entries |
| `resolve` | `POST /workspaces/:id/catalog/{agents,skills}/resolve` | Preview an install plan (network fetch, read prereqs, see deps) |
| `show <fqn>` | `GET /workspaces/:id/catalog/{agents,skills,mcps}/:fqn` | Show one entry (`--anchor` on agent/skill returns just the header bytes) |
| `install` | `POST /workspaces/:id/catalog/{agents,skills,mcps}` | Install by `--url <origin>` OR `--file <abs-path>` |
| `update <fqn>` | `PUT /workspaces/:id/catalog/{agents,skills,mcps}/:fqn` | Replace content (`--content <text>` or `--content-file <path>`; agents/skills only, MCPs use their own JSON shape) |
| `patch <fqn>` | `PATCH /workspaces/:id/catalog/{agents,skills}/:fqn` | Patch metadata (`--metadata <json>` or `--metadata-file <path>`; agents/skills only) |
| `rm <fqn>` | `DELETE /workspaces/:id/catalog/{agents,skills,mcps}/:fqn` | Remove |
| `sync-resolve <fqn>` | `POST /workspaces/:id/catalog/{agents,skills,mcps}/:fqn/sync-resolve` | Preview a re-sync plan against the upstream origin (mints a single-use `planToken`, 5-min TTL) |
| `sync <fqn>` | `POST /workspaces/:id/catalog/{agents,skills,mcps}/:fqn/sync` | Apply a previewed sync plan (`--plan-token <token>`; `PlanTokenInvalid` 410 if expired) |

Additional **agent-only** subcommands (skills have `ack-prereqs`; MCPs have neither):

| Subcommand | Route | Purpose |
| --- | --- | --- |
| `ack-prereqs <fqn>` | `POST /workspaces/:id/catalog/agents/:fqn/ack-prereqs` | Acknowledge prereqs (lifts the `needsPrereqsAck` block). Also on `catalog skill ack-prereqs`. |
| `enable <fqn>` | `POST /workspaces/:id/catalog/agents/:fqn/enable` | Re-enable a disabled agent |
| `disable <fqn>` | `POST /workspaces/:id/catalog/agents/:fqn/disable` | Disable an agent (new dispatches fail with `EntryNotReadyError`, `reason.disabledByUser: true`) |

### Output shapes

- `agent list` / `agent show`: `AgentEntry` — see [json-shapes.md#agententry](./json-shapes.md#agententry)
- `skill list` / `skill show`: `SkillEntry` — same skeleton (`entry`, `status`, `blockedReason?`), different `entry` payload
- `mcp list` / `mcp show`: `McpEntry` — no `status` (MCPs have no runtime blocked-state; validity is enforced at install)
- `install` / `sync`: `{ installed: [{ kind, fqn, version, action }] }` — one row per touched entry (may include transitively-installed deps)
- `resolve` / `sync-resolve`: `ResolveManifest` — `{ planToken, actions: [{ kind, action, fqn, version? }], entry: { prereqs? }, versionChanges? }`; token is consumed by the matching `install --plan-token` or `sync --plan-token`

---

## runtime

`glyph runtime list`

- Route: `GET /runtimes`
- Output: `Runtime[]` — `{ kind, capabilities: { remoteSession: bool } }`. Currently only `copilot` ships. `kind` is what you pass to `--runtime` on `task dispatch` / `session new` / `schedule create`.

---

## Server inspection

Not workspace-scoped; useful for scripting and diagnostics.

| Command | Route | Purpose | Notes |
| --- | --- | --- | --- |
| `glyph health` | `GET /api/health` | Probe server reachability | Exit 0 ⇒ server reachable and healthy. Prefer this over `status` if you just want a yes/no. |
| `glyph config` | `GET /api/config` | Print the server's resolved configuration | Includes port, home dir, runtime registry. Great for debugging "which server did I hit". |
| `glyph status` | (local — checks pid file, not the wire) | Print whether the server is running | `--json` returns `{ state: "running"|"not_running"|..., note? }`. Cleans up stale pid files as a side effect. |
| `glyph logs` | (local — tails server log file) | Print / tail the server log | `-f, --follow` for live tail. No `--json`; format is server-defined text. |

## See also

- [`SKILL.md`](../SKILL.md) — top-level conventions (workspace scoping, output/error discipline, anti-patterns)
- [`workflow-commands.md`](./workflow-commands.md) — `glyph workflow …` per-subcommand reference
- [`json-shapes.md`](./json-shapes.md) — payload shapes returned by `--json`
- [`error-codes.md`](./error-codes.md) — every `code` the server emits + the matching `glyph` command to fix it
- [`workflows.md`](./workflows.md) — multi-step playbooks (install-and-verify, dispatch-and-wait, monitor, sync, clean up, onboard)
