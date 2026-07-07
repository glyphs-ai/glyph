# Error code reference

Every error from the glyph server has the envelope `{error, code?, ...}`. The CLI's `formatError` surfaces both the human message AND the `code`, like:

```
workspace not found (HTTP 404, WorkspaceNotFound)
```

For `EntryNotReady` it also unpacks `agent` and `reason` into structured CTAs:

```
agent "writer" is not ready: prereqs not acknowledged (HTTP 409, EntryNotReady)
  agent: acme/writer
  cause: prereqs not acknowledged
  fix:   glyph catalog agent ack-prereqs acme/writer
```

When you see a `fix:` line, run that command verbatim — it's the canonical remediation.

## Where `code` values come from

`code` values are stable wire contracts. The server has three emission paths and they all land in the same `{error, code}` envelope:

1. **DU-based** — `packages/api/src/_error-policies/*.ts` policy tables project a
   domain discriminated-union `.type` field directly to the wire `code`. These
   carry NO `Error` suffix (`WorkspaceNotFound`, `TaskNotFound`,
   `WorkflowAlreadyTerminal`, …).
2. **Class-based** — the `SAFE_ERROR_NAMES` allow-list in
   `packages/api/src/_http-errors.ts` projects thrown-error class `.name` to
   the wire `code`, KEEPING the `Error` suffix. Only classes that actually
   exist and are actually thrown from a route path reach the wire; every
   entry in this doc has been grep-verified against `class <Name> extends
   Error` in the source. (The allow-list itself is forward-compat and
   lists more names than are currently thrown — this doc only covers the
   reachable subset.)
3. **Inline route literals** — a handful of handlers emit
   `problemResponse(c, <status>, {code: "..."})` directly (`BadRequest`,
   `NotFound`, `NoEventsYet`, `PlanTokenInvalid`, …).

Treat every value in the table below as a contract.

## Full code table

### Workspaces

| code | HTTP | meaning | fix |
|---|---|---|---|
| `WorkspaceNotFound` | 404 | Workspace id isn't registered | `glyph workspace list` to find a real id |
| `WorkspacePathConflict` | 409 | Two workspaces on the same workdir | Pick a different `--workspace-dir` |
| `ProvisioningFailed` | 500 | Server couldn't provision the workspace on disk | Server-side; surface with request id |
| `WorkspaceHasLiveTasksError` | 409 | Reload would orphan running task subprocesses | Cancel/wait for the tasks (`glyph task list --status running`), retry |
| `WorkspaceLoadError` | 500 | Failed to load a workspace context | Server-side; surface with request id |

### Sessions

| code | HTTP | meaning | fix |
|---|---|---|---|
| `SessionNotFound` | 404 | Session id unknown | `glyph session list` to find it |
| `UnknownRuntime` | 400 | Runtime name not registered | Check the runtime literal (`copilot`, `codex`, …) |
| `RuntimeStateDeletionFailed` | 409 | Runtime state cleanup blocked | Retry; if persistent, server-side |
| `RuntimeProvisionFailed` | 500 | Couldn't start the runtime process | Check runtime config; usually needs CLI binary on PATH |
| `SandboxProvisionFailed` | 500 | Sandbox couldn't be created | Server-side; check logs |
| `SandboxRemovalFailed` | 409 | Sandbox cleanup blocked | Retry; if persistent, server-side |

### Tasks

| code | HTTP | meaning | fix |
|---|---|---|---|
| `TaskNotFound` | 404 | Task id unknown | `glyph task list` to find it |
| `OriginQueryMalformed` | 400 | `task list` got `--origin` / `--origin-id` (HTTP `origin` / `originId`) partially — one without the other | Supply both flags together, or neither |
| `UnknownOriginKind` | 400 | `--origin <kind>` is not a known origin kind | Use one of `standalone`, `schedule`, `workflow` |
| `AgentNotFound` | 404 | Agent FQN not installed | `glyph catalog agent install --url <url>` |
| `EntryNotReady` | 409 | Agent is blocked — see `reason` | See "EntryNotReady reasons" below |
| `RuntimeDoesNotSupportTasks` | 501 | Runtime can't dispatch tasks | Pick a runtime that does (e.g. copilot) |
| `DispatchKernelEnvCollision` | 422 | Subprocess env key collides with a kernel key | Rename the offending env var |
| `InvalidTransition` | 409 | Illegal task state transition (e.g. cancel a completed task) | Check `fromStatus` extension; usually a stale action |
| `ManagerShuttingDown` | 503 | Task manager is shutting down | Retry after restart |
| `AgentUnresolvable` | 500 | Agent FQN couldn't be resolved server-side | Server-side; surface with request id |
| `WorkdirFailed` | 503 | Workdir setup/teardown failed | Retry; check disk / permissions |
| `RuntimeHeadlessLaunchFailed` | 500 | Runtime headless launch failed | Check runtime config |
| `RuntimeActivityReadFailed` | 500 | Couldn't read runtime activity events | Server-side; check logs |
| `CorruptedTask` | 500 | Task metadata column is corrupted | `glyph task rm <tid> --purge` to clean |
| `PurgeFailed` | 500 | Task purge failed | Retry; check disk / permissions |
| `NoEventsYet` | 404 | Runtime hasn't produced activity events yet (route-inline) | Wait, then retry |

### Workflows

| code | HTTP | meaning | fix |
|---|---|---|---|
| `WorkflowNotFound` | 404 | Workflow id unknown | `glyph workflow list` |
| `WorkflowNodeNotFound` | 404 | Workflow node id unknown | `glyph workflow dag <wfid>` to find it |
| `NodeSpecError` | 422 | Node spec failed validation | Read the message; fix the payload |
| `EmptyParents` | 422 | Node has no parent | Add at least one `parentIds` entry |
| `WorkflowSubgraphInvalid` | 422 | Subgraph invariant violated (cycle, orphan, ref unresolved, …) | Read the extension `reason` and fix |
| `HumanNodeResponseInvalid` | 422 | Human-node response failed validation | Fix the response payload |
| `WorkflowAlreadyTerminal` | 409 | Workflow is already terminal | No mutation on terminal workflows |
| `WorkflowNodeNotMutable` | 409 | Node isn't mutable from its current status | Check `fromStatus` extension |
| `WorkflowDeleteRequiresTerminal` | 409 | Workflow must be terminal before delete | Cancel/finish it first |
| `WorkflowDeleteHasInFlightTasks` | 409 | Delete blocked by in-flight tasks (route-inline) | Cancel/wait for the tasks |
| `WorkflowDagConflict` | 409 | DAG mutation would violate an invariant | Read `reason` — orphan, cycle, parent state, etc |
| `WorkflowCoordAgentNotCapableError` | 422 | Coord agent lacks `coordEligible` (thrown class, table-mapped) | Pick a coord-eligible agent |
| `WorkflowCoordSpecError` | 422 | Coordinator spec invalid (thrown class, table-mapped) | Read the message |
| `WorkflowWorkerSpecError` | 422 | Worker spec invalid (thrown class, table-mapped) | Read the message |
| `WorkflowHumanSpecError` | 422 | Human spec invalid (thrown class, table-mapped) | Read the message |
| `WorkflowWorkerNotInCoordMenuError` | 500 | Worker fqn not in the coord's declared menu (thrown class) | Server-side invariant; report |
| `WorkflowError` | 400 | Workflow pkg generic error (route-inline) | Read the message |
| `WorkflowInvariantViolation` | 500 | Server-side invariant tripped | Report with request id |
| `WorkflowDirReservationFailed` | 503 | Workflow dir couldn't be reserved | Check disk; retry |

### Schedules

| code | HTTP | meaning | fix |
|---|---|---|---|
| `ScheduleNotFound` | 404 | Schedule id unknown | `glyph schedule list` |
| `ScheduleKindMismatch` | 404 | Route kind doesn't match the schedule's `target.kind` | Use the matching route |
| `InvalidScheduleId` | 400 | Malformed schedule id | Check the format |
| `InvalidScheduleName` | 400 | Empty or non-string name | Provide a non-empty string |
| `InvalidCronExpr` | 400 | Cron expression didn't parse | Check the 5-field cron syntax |
| `InvalidTimezone` | 400 | Not a valid IANA timezone | Use e.g. `UTC`, `America/Los_Angeles` |
| `TargetKindImmutable` | 400 | `target.kind` cannot change on update | Delete + recreate the schedule |
| `TaskTargetInvalid` | 400 | Task target payload validation failed | Read the message |
| `WorkflowTargetInvalid` | 400 | Workflow target payload validation failed | Read the message |
| `ScheduleEnabled` | 409 | Cannot delete an enabled schedule | Disable first (`glyph schedule disable <id>`) |
| `ScheduleHasInFlight` | 409 | Cannot delete while a fired dispatch is in flight | Wait for the fire to finish |
| `ScheduleKindNotRegistered` | 500 | Target `kind` isn't registered server-side | Report with request id |
| `ScheduleCorruption` | 500 | Persisted schedule row is corrupted | Report; may need manual DB repair |

### Catalog

| code | HTTP | meaning | fix |
|---|---|---|---|
| `SkillNotFound` | 404 | Skill FQN not installed | `glyph catalog skill install --url <url>` or `--file <path>` |
| `AgentNotFound` | 404 | Agent FQN not installed (shared with session/task) | `glyph catalog agent install --url <url>` or `--file <path>` |
| `McpNotFound` | 404 | MCP not installed | `glyph catalog mcp install --url <url>` or `--file <path>` |
| `SkillOriginConflict` | 409 | Two skills with same FQN, different origins | Pick one; remove the other |
| `AgentOriginConflict` | 409 | Two agents with same FQN, different origins | Pick one; remove the other |
| `McpOriginConflict` | 409 | Two MCPs with same FQN, different origins | Pick one; remove the other |
| `HasDependents` | 409 | Cannot remove: other catalog entries depend on this one | Remove dependents first |
| `OriginInvalid` | 400 | Malformed origin URL | Check the URL format |
| `ManifestInvalid` | 400 | Catalog manifest validation failed | Read message; fix the upstream manifest |
| `SourceUnavailable` | 502 | Couldn't fetch the origin (404, network error, etc) | Check the URL is reachable; transient — safe to retry |
| `PlanTokenInvalid` | 410 | `--plan-token` was malformed, expired, or already consumed (route-inline) | Re-run the corresponding `... sync-resolve` to mint a fresh token |

### Terminal (session `/spawn`)

The `/spawn` route wraps most launch failures as `200 {ok: false, code, error}` so the dashboard can fall back to a copy-paste command without a second round-trip. These `*Error` codes appear as wire `code` only in the rare cases where the class actually propagates out as a thrown error; when that happens the session route has no dedicated policy row, so the fallback `defaultStatus` (400) is used.

| code | HTTP | meaning | fix |
|---|---|---|---|
| `NoTerminalFoundError` | 400 (fallback) / 200 body | Couldn't find a terminal to spawn the session in | Server-side; check OS terminal config |
| `TerminalSpawnFailedError` | 400 (fallback) / 200 body | Terminal spawn failed | Same |
| `UnsupportedPlatformError` | 400 (fallback) / 200 body | Operation not supported on this OS | No remedy; cross-platform gap |

### Generic / route-inline

| code | HTTP | meaning | fix |
|---|---|---|---|
| `BadRequest` | 400 | Generic 400 emitted inline from a handler (malformed body, invalid query) | Read the message; fix the call |
| `NotFound` | 404 | Generic 404 emitted inline from a handler (e.g. artifact id) | Check the id; usually a typo or stale reference |
| `DatabaseUnavailable` | 503 | SQLite backing store unavailable (any package) | Server-side; surface with request id |
| `internal error` (no `code`) | 500 | Server-side fault whose underlying error name was suppressed (not on the safe-error allow-list). Message alone won't tell you remediation | Surface to user with the request id from server logs |

## EntryNotReady reasons

`EntryNotReady` always carries a `reason: BlockedReason` payload. The CLI auto-renders the matching CTA, but here's the cheat-sheet for AI logic:

| `reason` field | meaning | exact CLI fix |
|---|---|---|
| `disabledByUser: true` | Agent was manually disabled | `glyph catalog agent enable <fqn>` |
| `needsPrereqsAck: true` | User hasn't acknowledged the entry's `prereqs` | `glyph catalog agent ack-prereqs <fqn>` (or `skill ack-prereqs`) |
| `orphaned: true` | Skill/MCP installed but no agent references it | Either install an agent that uses it, or `glyph catalog skill rm <fqn>` |
| `missingDeps: [{kind, fqn}, ...]` | Listed dependencies aren't installed | For each: `glyph catalog <kind> install <origin>` (origin from upstream catalog) |
| `blockedDeps: [{kind, fqn}, ...]` | Listed dependencies are themselves blocked | Recursively apply this table to each dep |

A single `EntryNotReady` can carry multiple `reason` fields at once (e.g. both `needsPrereqsAck` AND `missingDeps`). The CLI prints one `cause:` line per active field; resolve all of them, then retry the original command.

If the CLI prints `cause: blocked (reason fields not recognized by this CLI version)`, the server has emitted a new `BlockedReason` variant the CLI doesn't know about. Inspect via the dashboard or upgrade the CLI for typed remediation.
