# JSON payload shapes

Every field a `glyph <cmd> --json` invocation is likely to return. Optional fields are marked `?` — they appear only when the underlying database column is non-null OR when the entity is in the state that produces them. This doc trails the wire contract, not the source: consult `packages/*/src/application/**` for the exact zod schemas.

> **Convention.** Timestamps are always ISO 8601 UTC (`"2026-07-07T00:33:55.000Z"`). Ids are opaque strings (workspace ids are UUIDs, task/workflow ids are `YYYYMMDD-<8-hex>`, session ids are `<timestamp>-<uuid>`). Never parse them for meaning.

---

## Index

- [Workspace](#workspace)
- [Session](#session)
- [Task](#task)
- [ActivityItem](#activityitem)
- [TerminalResult](#terminalresult) (task `success` / `failure` / `cancellation` payloads)
- [Schedule](#schedule)
- [AgentEntry](#agententry) (also documents `status` / `BlockedReason`)
- [ResolveManifest](#resolvemanifest) (`catalog … resolve` / `sync-resolve`)
- [WorkflowHeader](#workflowheader)
- [WorkflowDag](#workflowdag) (`nodes` / `edges` element shapes)
- [Runtime](#runtime)
- [ServerStatus](#serverstatus) (local — from `glyph status --json`)

---

## Workspace

Returned by `workspace list`, `workspace add`, `workspace show`, `workspace update`, `workspace reload`.

```jsonc
{
  "id": "b357f7cb-fd06-41e8-8edd-16328da736c9",
  "workspaceDir": "/home/langsensei/.glyph/workspaces/b357f7cb-...",
  "name": "default",
  "createdAt": "2026-06-13T21:05:28.962Z",
  "lastOpenedAt": "2026-06-13T21:05:28.962Z"
}
```

`workspace current --json` returns a narrower `{ "id": "..." }` — just the resolved id, no other columns.

---

## Session

Returned by `session list`, `session new`, `session show`.

```jsonc
{
  "id": "20260702-a1b2c3d4e5f6...",
  "agent": "official/coordinator",             // optional — sessions may be agent-less
  "runtime": "copilot",                        // always present; matches --runtime on create
  "workdir": "/home/user/.glyph/workspaces/<wsid>/sessions/<sid>",
  "runtimeSessionId": "6e53532e-...",          // runtime-provided handle (opaque)
  "createdAt": "2026-07-02T10:15:00.000Z",
  "lastActiveAt": "2026-07-02T11:42:03.000Z"   // updated by the runtime as turns come in
}
```

`session spawn --json` returns `{ command: string[], workdir: string, env: Record<string,string> }` — the exact argv you'd exec in a terminal to attach.

---

## Task

Returned by `task list`, `task dispatch`, `task show`, `schedule list-tasks`.

```jsonc
{
  "id": "20260617-5ab73e2d",
  "agent": "langsensei/gusu-scribe",
  "brief": "Article draft",
  "details": "Multi-line context...",          // optional — omitted if null
  "origin": "standalone",                       // "standalone" | "schedule:<sid>" | "workflow:<wfid>"
  "status": "succeeded",                        // "running" | "succeeded" | "failed" | "cancelled"
  "metadata": {
    "workdir": "/.../tasks/20260617-5ab73e2d",
    "runtimeSessionId": "6e53532e-...",
    "runtime": "copilot",
    "workflowNodeId": "af12...",                // present iff origin starts with "workflow:"
    "scheduleId": "..."                          // present iff origin starts with "schedule:"
  },
  "createdAt": "2026-06-17T06:52:56.184Z",
  "startedAt": "2026-06-17T06:52:56.184Z",     // absent while pending
  "endedAt":   "2026-06-17T06:54:28.778Z",     // absent while running
  "success":      { ... },                      // present iff status === "succeeded"
  "failure":      { ... },                      // present iff status === "failed"
  "cancellation": { ... }                       // present iff status === "cancelled"
}
```

Exactly one of `success` / `failure` / `cancellation` is present when the task is terminal; none are present while `status === "running"`. See [TerminalResult](#terminalresult).

---

## ActivityItem

Returned by `task activity` (either in the `activity` array or one-per-line under `--follow`).

Common envelope:

```jsonc
{
  "kind": "assistant",                         // one of: "user" | "assistant" | "tool_use" | "tool_result" | "thinking" | "system" | "error"
  "seq": 22,                                    // monotonic per-task; use for resume
  "id": "bcc50283-...",                         // uuid of the underlying runtime frame
  "timestamp": "2026-06-17T06:54:28.737Z"
}
```

Kind-specific extras (common cases):

- `"assistant"` — `{ text, model?, tokens?: { output, input? }, stop_reason? }`
- `"user"` — `{ text }`
- `"thinking"` — `{ text }` (reasoning trace; only when the runtime surfaces it)
- `"tool_use"` — `{ name, input: object, tool_use_id }`
- `"tool_result"` — `{ tool_use_id, output: string, is_error?: boolean }`
- `"system"` — `{ event: string, data?: object }` — runtime lifecycle notes
- `"error"` — `{ message, stack? }`

One-shot response envelope (non-`--follow`):

```jsonc
{
  "activity": [ ActivityItem, ... ],           // tail-first: last item is the newest seq
  "result":   TerminalResult | null,           // populated once the task has terminated
  "totalItems": 24,                             // full seq count; derive hasNewer via activity[-1].seq < totalItems - 1
  "truncated": {                                // present when a --limit page cut the tail off
    "reason": "page_limit",
    "hint":   "Showed last 2 of 24 items — request again with before=22 to read older history."
  }
}
```

Under `--follow`, stdout is an NDJSON stream of `ActivityItem`s (one per line, in seq order). The server terminates the stream with an `event: end` frame; the CLI prints `last seq: <N>` to stderr and exits 0.

---

## TerminalResult

The three arm shapes that populate a task's `success` / `failure` / `cancellation` field, and the workflow terminal shapes on `workflow finish` / `workflow show`.

```jsonc
// Task success
{
  "output":    "human summary string",
  "artifacts": [ "/abs/path/to/file1", "/abs/path/to/file2", ... ]  // absolute paths on the server
}

// Task failure
{
  "kind":    "runner" | "system" | "timeout" | "user_error",
  "message": "reason string",
  "cause":   "optional extra context"                                // may be absent
}

// Task cancellation
{
  "kind":    "user" | "coordinator" | "operator" | "workflow",
  "message": "reason string"
}
```

Workflow-level terminal shapes (on `WorkflowHeader.success` / `.failure` / `.cancellation`):

```jsonc
// Workflow success
{ "output": "summary string" | null }

// Workflow failure — the only currently-valid kind is "coordinator"
{ "kind": "coordinator", "message": "reason" }

// Workflow cancellation
{ "kind": "user", "message": "reason" }
```

---

## Schedule

Returned by `schedule list`, `schedule create`, `schedule show`, `schedule patch`, `schedule enable/disable`, `schedule run` (with the freshly-dispatched task alongside).

```jsonc
{
  "id":        "sched-...",
  "name":      "Daily audit",
  "trigger": {
    "cron":    "0 9 * * *",                     // 5-, 6-, or 7-field cron expression
    "tz":      "Asia/Shanghai"                  // IANA timezone
  },
  "target": {
    "kind":    "task",                          // "task" | "workflow"
    "agent":   "official/engineer",             // task-kind
    "brief":   "...",
    "details": "..." | null,                    // null means "no details set"; absent means "keep existing" on patch
    "runtime": "copilot" | null                 // same null-vs-absent semantics as details
    // workflow-kind target instead has: coordinatorAgent, brief, details (no runtime)
  },
  "enabled":    true,
  "createdAt":  "2026-06-14T00:00:00.000Z",
  "updatedAt":  "2026-06-14T00:00:00.000Z",
  "lastFireAt": "2026-07-07T09:00:00.000Z" | null   // null before the first fire
}
```

`schedule preview --json` returns:

```jsonc
{
  "describe": "At 09:00 on every day",         // human description of the cron
  "nextRuns": [ "2026-07-08T09:00:00+08:00", "2026-07-09T09:00:00+08:00", ... ]
}
```

---

## AgentEntry

Returned by `catalog agent list`, `catalog agent show`.

```jsonc
{
  "agent": {
    "fqn":          "langsensei/gusu-scribe",
    "origin":       "https://github.com/langsensei/agentic-catalog/tree/main/agents/gusu-scribe",
    "description":  "Suzhou cultural prose writing — ...",
    "version":      "1.5.0",
    "prereqsAck":   true,
    "disabledByUser": false,
    "installedAt":  "2026-06-13T21:05:37.410Z",
    "updatedAt":    "2026-06-13T21:05:37.410Z",
    "mutable":      false                        // true for file:// origins
  },
  "status":         "ready" | "blocked",
  "coordEligible":  false,                       // true iff the agent declares official/workflow-coordination
  "blockedReason":  BlockedReason                // present iff status === "blocked"
}
```

`SkillEntry` and `McpEntry` mirror this envelope; `McpEntry` has no `status` / `coordEligible` / `blockedReason` (MCPs cannot be runtime-blocked). The `entry` payload differs by kind.

### BlockedReason

Any combination of the following fields may be set at once. Resolve every one before retrying the original operation.

```jsonc
{
  "disabledByUser":  true,                       // -> catalog {agent|skill} enable <fqn>
  "needsPrereqsAck": true,                       // -> catalog {agent|skill} ack-prereqs <fqn>
  "orphaned":        true,                       // skill/mcp with no dependent agent — install one, or rm the entry
  "missingDeps":  [ { "kind": "skill", "fqn": "official/git-pr" }, ... ],
  "blockedDeps":  [ { "kind": "agent", "fqn": "..." }, ... ]  // recurse: read each dep's own BlockedReason
}
```

See [`error-codes.md#entrynotreadyerror-reasons`](./error-codes.md#entrynotreadyerror-reasons) for the matching remediation table.

---

## ResolveManifest

Returned by `catalog {agent|skill|mcp} resolve` (fresh install preview) and `sync-resolve` (in-place update preview). Both mint a single-use `planToken` with a 5-minute TTL that you feed to the corresponding `install --plan-token <token>` or `sync --plan-token <token>`.

```jsonc
{
  "planToken":  "opaque-string",                 // 5-min TTL, single-use
  "actions": [
    {
      "kind":     "agent" | "skill" | "mcp",
      "action":   "install" | "update" | "noop",
      "fqn":      "acme/writer",
      "version":  "1.2.0"                        // absent on noop
    },
    ...
  ],
  "entry": {                                     // present only on `resolve` (fresh install) — the root entry to be installed
    "prereqs":  "markdown prereqs text" | null
  },
  "versionChanges": [                            // present only on `sync-resolve`
    { "fqn": "acme/writer", "from": "1.1.0", "to": "1.2.0" }
  ]
}
```

---

## WorkflowHeader

Returned by `workflow list`, `workflow create`, `workflow show`, `workflow cancel`, `workflow finish`.

```jsonc
{
  "id":               "20260706-d4bcf16b",
  "brief":            "Add /healthz endpoint",
  "details":          "Long-form context..." | null,
  "coordinatorAgent": "official/coordinator",
  "status":           "running" | "succeeded" | "failed" | "cancelled",
  "iterationCount":   3,                         // count of worker dev nodes in the DAG; absent on `list` (skipped for perf)
  "createdAt":        "2026-07-06T14:00:00.000Z",
  "startedAt":        "2026-07-06T14:00:01.000Z",
  "endedAt":          "2026-07-06T17:16:00.000Z", // absent while running
  "success":          { "output": "..." | null }, // present iff status === "succeeded"
  "failure":          { "kind": "coordinator", "message": "..." }, // present iff status === "failed"
  "cancellation":     { "kind": "user", "message": "..." }         // present iff status === "cancelled"
}
```

---

## WorkflowDag

Returned by `workflow dag`.

```jsonc
{
  "header": WorkflowHeader,                      // as above, with accurate iterationCount
  "nodes":  [ WorkflowNode, ... ],
  "edges":  [ WorkflowEdge, ... ]
}
```

### WorkflowNode

Returned by `workflow node-show`, and one element of `WorkflowDag.nodes`.

```jsonc
{
  "id":         "af12...",
  "workflowId": "20260706-d4bcf16b",
  "kind":       "coordinator" | "worker" | "human",
  "spec": {
    "kind":     "coordinator" | "worker" | "human",   // mirrors node.kind
    "agent":    "official/engineer",                    // coordinator/worker spec
    "brief":    "...",                                  // worker spec
    "details":  "...",                                  // worker spec
    "choices": [                                        // human spec only
      { "id": "approve", "label": "Approve" },
      { "id": "reject",  "label": "Reject" }
    ]
  },
  "phase":     2,                                       // topological phase (integer, monotonic in DAG order)
  "status":    "not_started" | "running" | "succeeded" | "failed" | "cancelled",
  "createdAt": "2026-07-06T14:05:00.000Z",
  "readyAt":   "2026-07-06T14:05:05.000Z",              // when all parents terminated in a "runnable" state
  "runningAt": "2026-07-06T14:05:06.000Z",              // when the runtime picked it up
  "endedAt":   "2026-07-06T14:20:00.000Z",              // absent while running
  "taskId":    "20260706-abcd1234",                     // present after dispatch for coordinator/worker nodes; look up via `task show`
  "responseInput":   "freeform text",                   // human node — set on respond
  "responseChoiceId": "approve"                          // human node — set on respond
}
```

Node kinds have distinct terminal semantics: a `coordinator` node's terminal is set by its own `workflow finish` call, `worker` inherits from its underlying task, and `human` transitions to `succeeded` on the first valid `workflow respond`.

### WorkflowEdge

```jsonc
{ "from": "<node-id>", "to": "<node-id>" }
```

Edges are directed and unique; the substrate rejects duplicates. Every non-initial node has ≥ 1 incoming edge.

---

## Runtime

Returned by `runtime list`.

```jsonc
{
  "kind":         "copilot",
  "capabilities": { "remoteSession": true }
}
```

`kind` is what you pass to `--runtime` on `task dispatch` / `session new` / `schedule create`. Currently only `copilot` ships in-tree.

---

## ServerStatus

Returned by the local `glyph status --json` command (does NOT talk to the wire — reads the pid file).

```jsonc
{
  "state": "running" | "not_running" | "stopping" | "starting" | "unknown",
  "pid":   12345,                                  // present iff state === "running"
  "note":  "cleaned up stale pid 1989106"          // optional — printed when the CLI GC'd a stale record
}
```

Use `glyph health` (a wire probe) instead when you actually need to know whether HTTP requests will succeed.

---

## See also

- [`SKILL.md`](../SKILL.md) — output discipline, exit codes, streaming resume pattern
- [`commands.md`](./commands.md) — per-subcommand reference (flags, routes, which shape maps to which command), including `## workflow`
- [`error-codes.md`](./error-codes.md) — server error codes and remediation
