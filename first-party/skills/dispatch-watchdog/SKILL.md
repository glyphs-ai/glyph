---
name: dispatch-watchdog
scope: official
description: "Spawns a properly-detached cross-platform watchdog over a running glyph task or workflow — polls status, exits on terminal state, and reliably surfaces runtime completion notifications to the orchestrator session"
version: 0.2.0
---

# Dispatch Watchdog Skill

## Domain

A single primitive for any orchestrator agent that dispatches a
long-running `glyph` task or workflow: given an id, spawn a watchdog
that polls `glyph <kind> show <id> --json` on a configurable cadence
and exits when the entity reaches a terminal status (`succeeded`,
`failed`, `cancelled`). The watchdog must be spawned in a way that
the glyph runtime can observe its completion and deliver a
notification back to the orchestrator's session — not all spawn
patterns achieve this.

## Boundary

**In scope:**
- Spawning a detached watchdog process from the orchestrator's shell
  using the runtime's `mode:async + detach:true` primitive.
- A polling loop that reads task or workflow status via the glyph CLI
  and exits cleanly on terminal state.
- A persisted watchdog log (one line per poll) for after-the-fact
  inspection.
- Cross-platform invocation (Windows and macOS/Linux share one Node
  body; only the OS-level spawn wrapper differs).

**Out of scope:**
- Interpreting task output or success/failure semantics — that is the
  caller's job after notification.
- Cancelling stuck tasks — see the caller's stuck-task playbook.
- Replacing the orchestrator's own monitoring tick loop; this is for
  *single* long-running tasks or workflows where polling-in-foreground
  would block other work.

## Why this skill exists

The glyph runtime delivers a notification to the orchestrator's
session when a watchdog process associated with the session reaches a
terminal state — **but only if the watchdog was spawned through the
correct primitive**. Four spawn patterns commonly tried in practice,
and the empirical outcome of each:

| # | Pattern | Outcome |
|---|---|---|
| 1 | `task` tool with a subagent (e.g. Haiku) | Subagent often *describes* the work instead of executing the loop; unreliable. |
| 2 | `Start-Process pwsh -ArgumentList …` | Process spawns but bypasses runtime wiring; **no completion notification**. |
| 3 | `powershell mode:async` (no `detach`) | Tied to the session shell; session shutdown kills the watchdog before it can complete. |
| 4 | `powershell mode:async, detach:true` | ✅ Reliably produces completion notifications and survives session lifecycle. |

This skill canonicalises **pattern 4** and its bash equivalent so no
orchestrator has to rediscover them.

## Primitive

The skill ships a Node script `watchdog.mjs` next to this file. Refer
to it via the `<SKILL_DIR>` placeholder — your runtime resolves the
path from context, so the body stays neutral across Copilot CLI,
Claude Code, Gemini CLI, Cursor, Windsurf, Codex, and any other
provisioner. The script depends only on the Node stdlib and runs
identically on Windows, macOS, and Linux.

> `<SKILL_DIR>` is the directory containing this `SKILL.md`. Resolve
> from your runtime context.

### Script CLI

```
node <SKILL_DIR>/watchdog.mjs \
     <task|workflow> <id> <abs-log-path> [poll-sec=60] [max-loops=240]
```

- `<task|workflow>` — selects which glyph subcommand to poll
  (`glyph task show` vs `glyph workflow show`).
- `<id>` — the task or workflow id. Server-generated ids match
  `^[A-Za-z0-9-]+$`; the script rejects anything else (defence-in-depth
  against shell injection through the polled CLI command).
- `<abs-log-path>` — **must be absolute**. The script does not resolve
  relative paths; under detached spawn `process.cwd()` is unspecified.
- `[poll-sec]` — seconds between polls; default 60.
- `[max-loops]` — give-up bound; default 240 (≈4 hours at the default
  cadence). On hitting the bound the script writes
  `max-loops-exceeded` and exits 1.

Status extraction uses `JSON.parse(raw).status`, which indexes the
top-level field directly. This is robust against long string values,
backslash escapes (e.g. Windows paths in workflow `details`), and any
`"status": "..."` substrings that appear inside nested string content
— a regex against the raw JSON cannot make that distinction.

### PowerShell (Windows) — spawn via `mode:async + detach:true`

```text
# In glyph / Copilot CLI tool form:
#   powershell:
#     command:     node <SKILL_DIR>/watchdog.mjs task <tid> "<missionDir>\watchdog.log"
#     mode:        async
#     detach:      true
#     initial_wait: 10
```

Use `workflow` in place of `task` to poll `glyph workflow show
<wfid> --json` instead.

The orchestrator returns immediately to other work; the runtime
notifies the session when the watchdog exits.

### Bash (macOS / Linux) — same pattern, runtime auto-wraps in `setsid`

```text
# In glyph / Copilot CLI tool form:
#   bash / shell:
#     command:     node <SKILL_DIR>/watchdog.mjs task <tid> "${mission_dir}/watchdog.log"
#     mode:        async
#     detach:      true
#     initial_wait: 10
```

(On Unix-like systems the runtime wraps detached commands with
`setsid` automatically; the notification path is the same as
Windows.)

## Watchdog log format

First line is the start marker (see Caller contract item 4). One line
per poll thereafter, monotonic-timestamp-prefixed, for debugging stuck
or runaway watchdogs:

```
2026-05-22T08:30:00+00:00 watchdog started for 20260522-abc12345
2026-05-22T08:31:00+00:00 status=running
2026-05-22T08:32:00+00:00 status=running
2026-05-22T08:33:00+00:00 status=succeeded
```

## Anti-patterns (do not use)

- **Do not** use the `task` tool with a Haiku/Sonnet subagent for the
  poll loop. Agents describe; they don't reliably loop.
- **Do not** use `Start-Process` to background the watchdog. The
  process is invisible to the runtime.
- **Do not** use `mode:async` without `detach:true`. Session
  shutdown will kill it.
- **Do not** poll faster than every ~15s without good reason — every
  poll is a CLI invocation that spawns a Node process.
- **Do not** reach for `child_process.execFileSync('glyph', ...)`
  when authoring an ad-hoc watchdog variant. On Windows + Node 22+
  the CVE-2024-27980 hardening refuses to spawn `.cmd` shims via
  `execFileSync` and throws `EINVAL`. The shipped `watchdog.mjs`
  uses `execSync` with a shell-routed command and a strict id-regex
  guard for exactly this reason — do not "fix" it to `execFileSync`.
- **Do not** extract `status` with a regex over the raw JSON. The
  `glyph workflow show --json` payload includes a `details` field
  that JSON-encodes the workflow brief verbatim; briefs frequently
  contain `"status": "..."` substrings, and a first-match regex
  picks those up instead of the top-level field. `watchdog.mjs`
  uses `JSON.parse(raw).status` to dodge this; preserve that.

## Caller contract

The caller (orchestrator) MUST:
1. Persist the id (`task-id.txt` in the mission folder is the
   convention for task ids; workflow ids follow the same per-mission
   file convention).
2. Invoke the watchdog once per id. Do not re-spawn if one is
   already alive. **Liveness = `watchdog.log` mtime within 2× the
   configured poll interval.** Older = dead; respawn.
3. On notification, read `watchdog.log`'s last line for the final
   status and proceed.
4. **Verify start within 5s of spawning.** Read the first line of
   `watchdog.log`; it MUST contain `watchdog started for <id>`. If
   the marker is absent, the watchdog is dead (bad args, missing id,
   exec failure) — fix the invocation and respawn. Do not proceed
   assuming monitoring is active.
5. **Verify status capture within 2× the configured poll interval.**
   Read `watchdog.log` and confirm at least one non-empty
   `status=<value>` line exists. A line reading `status=` with no
   value indicates the polled CLI returned a payload without a
   top-level `status` field, or the call itself failed (look for a
   `poll-error: …` line on the previous tick for detail). Fix the
   underlying issue and respawn — do NOT wait for a completion
   notification, it will never arrive.

## CHANGELOG

See `CHANGELOG.md` next to this file.
