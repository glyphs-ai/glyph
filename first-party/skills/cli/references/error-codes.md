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

1. **DU-based** — `packages/api/src/_error-policies/*.ts` policy tables project a domain
   discriminated-union `.type` field directly to the wire `code`. These carry NO `Error`
   suffix (`WorkspaceNotFound`, `TaskNotFound`, `WorkflowAlreadyTerminal`, …).
2. **Class-based** — the `SAFE_ERROR_NAMES` allow-list in `packages/api/src/_http-errors.ts`
   projects thrown-error class `.name` to the wire `code`, KEEPING the `Error` suffix
   (`WorkflowCoordSpecError`, `SessionNotFoundError`, `WorkflowError`, …).
3. **Inline route literals** — a handful of handlers emit `problemResponse(c, <status>, {code: "..."})`
   directly (`BadRequest`, `NotFound`, `NoEventsYet`, `PlanTokenInvalid`, …).

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
| `SessionNotFound` | 404 | Session id unknown (route-inline emission) | `glyph session list` to find it |
| `SessionNotFoundError` | 404 | Session id unknown (class-based emission) | Same as above |
| `InvalidSessionIdError` | 400 | Malformed session id | Check the format (timestamp-shortuuid) |
| `SessionIdAllocationFailedError` | 500 | Server couldn't mint a new session id | Retry; if persistent, server bug |
| `SessionError` | 400 | Session pkg generic error | Read the message |
| `UnknownRuntime` | 400 | Runtime name not registered | Check the runtime literal (`copilot`, `codex`, …) |
| `RuntimeStateDeletionFailed` | 409 | Runtime state cleanup blocked | Retry; if persistent, server-side |
| `RuntimeProvisionFailed` | 500 | Couldn't start the runtime process | Check runtime config; usually needs CLI binary on PATH |
| `SandboxProvisionFailed` | 500 | Sandbox couldn't be created | Server-side; check logs |
| `SandboxRemovalFailed` | 409 | Sandbox cleanup blocked | Retry; if persistent, server-side |

### Tasks

| code | HTTP | meaning | fix |
|---|---|---|---|
| `TaskNotFound` | 404 | Task id unknown | `glyph task list` to find it |
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
| `WorkflowNotFoundError` | 404 | Workflow id unknown (class-based emission) | Same |
| `WorkflowNodeNotFound` | 404 | Workflow node id unknown | `glyph workflow dag <wfid>` to find it |
| `WorkflowNodeNotFoundError` | 404 | Same (class-based) | Same |
| `NodeSpecError` | 422 | Node spec failed validation | Read the message; fix the payload |
| `EmptyParents` | 422 | Node has no parent | Add at least one `parentIds` entry |
| `EmptyParentsError` | 422 | Same (class-based) | Same |
| `WorkflowSubgraphInvalidError` | 422 | Subgraph invariant violated (cycle, orphan, ref unresolved, …) | Read the extension `reason` and fix |
| `HumanNodeResponseInvalid` | 422 | Human-node response failed validation | Fix the response payload |
| `WorkflowAlreadyTerminal` | 409 | Workflow is already terminal | No mutation on terminal workflows |
| `WorkflowAlreadyTerminalError` | 409 | Same (class-based) | Same |
| `WorkflowNodeNotMutable` | 409 | Node isn't mutable from its current status | Check `fromStatus` extension |
| `WorkflowNodeNotMutableError` | 409 | Same (class-based) | Same |
| `WorkflowDeleteRequiresTerminal` | 409 | Workflow must be terminal before delete | Cancel/finish it first |
| `WorkflowDeleteHasInFlightTasks` | 409 | Delete blocked by in-flight tasks | Cancel/wait for the tasks |
| `WorkflowDagConflictError` | 409 | DAG mutation would violate an invariant | Read `reason` — orphan, cycle, parent state, etc |
| `WorkflowCoordAgentNotCapableError` | 422 | Coord agent lacks `coordEligible` | Pick a coord-eligible agent |
| `WorkflowCoordSpecError` | 422 | Coordinator spec invalid | Read the message |
| `WorkflowWorkerSpecError` | 422 | Worker spec invalid | Read the message |
| `WorkflowHumanSpecError` | 422 | Human spec invalid | Read the message |
| `WorkflowNodeSpecError` | 422 | Node spec (kind-agnostic) invalid | Read the message |
| `WorkflowError` | 400 | Workflow pkg generic error | Read the message |
| `WorkflowWorkerNotInCoordMenuError` | 500 | Worker fqn not in the coord's declared menu | Server-side invariant; report |
| `WorkflowInvariantViolation` | 500 | Server-side invariant tripped | Report with request id |
| `WorkflowDirReservationFailed` | 503 | Workflow dir couldn't be reserved | Check disk; retry |
| `InvalidWorkflowIdError` | 400 | Malformed workflow id | Check the format |
| `InvalidWorkflowNodeIdError` | 400 | Malformed workflow node id | Check the format |

### Schedules

| code | HTTP | meaning | fix |
|---|---|---|---|
| `ScheduleNotFound` | 404 | Schedule id unknown | `glyph schedule list` |
| `ScheduleNotFoundError` | 404 | Same (class-based) | Same |
| `ScheduleKindMismatch` | 404 | Route kind doesn't match the schedule's `target.kind` | Use the matching route |
| `InvalidScheduleId` | 400 | Malformed schedule id | Check the format |
| `InvalidScheduleIdError` | 400 | Same (class-based) | Same |
| `InvalidScheduleName` | 400 | Empty or non-string name | Provide a non-empty string |
| `InvalidCronExpr` | 400 | Cron expression didn't parse | Check the 5-field cron syntax |
| `InvalidCronExprError` | 400 | Same (class-based) | Same |
| `InvalidTimezone` | 400 | Not a valid IANA timezone | Use e.g. `UTC`, `America/Los_Angeles` |
| `InvalidTimezoneError` | 400 | Same (class-based) | Same |
| `InvalidJsonPathError` | 400 | Malformed JSON-path patch | Check the RFC-6901 syntax |
| `TargetKindImmutable` | 400 | `target.kind` cannot change on update | Delete + recreate the schedule |
| `TaskTargetInvalid` | 400 | Task target payload validation failed | Read the message |
| `WorkflowTargetInvalid` | 400 | Workflow target payload validation failed | Read the message |
| `ScheduleEnabled` | 409 | Cannot delete an enabled schedule | Disable first (`glyph schedule disable <id>`) |
| `ScheduleEnabledError` | 409 | Same (class-based) | Same |
| `ScheduleHasInFlight` | 409 | Cannot delete while a fired dispatch is in flight | Wait for the fire to finish |
| `ScheduleHasInFlightError` | 409 | Same (class-based) | Same |
| `ScheduleError` | 400 | Schedule pkg generic error | Read the message |
| `ScheduleKindNotRegistered` | 500 | Target `kind` isn't registered server-side | Report with request id |
| `ScheduleCorruption` | 500 | Persisted schedule row is corrupted | Report; may need manual DB repair |

### Catalog

| code | HTTP | meaning | fix |
|---|---|---|---|
| `SkillNotFound` | 404 | Skill FQN not installed | `glyph catalog skill install --url <url>` or `--file <path>` |
| `AgentNotFound` | 404 | Agent FQN not installed | `glyph catalog agent install --url <url>` or `--file <path>` |
| `AgentNotFoundError` | 404 | Same (class-based; shared session/schedule/task) | Same |
| `McpNotFound` | 404 | MCP not installed | `glyph catalog mcp install --url <url>` or `--file <path>` |
| `SkillOriginConflict` | 409 | Two skills with same FQN, different origins | Pick one; remove the other |
| `AgentOriginConflict` | 409 | Two agents with same FQN, different origins | Pick one; remove the other |
| `McpOriginConflict` | 409 | Two MCPs with same FQN, different origins | Pick one; remove the other |
| `HasDependents` | 409 | Cannot remove: other catalog entries depend on this one | Remove dependents first |
| `OriginInvalid` | 400 | Malformed origin URL | Check the URL format |
| `ManifestInvalid` | 400 | Catalog manifest validation failed | Read message; fix the upstream manifest |
| `SourceUnavailable` | 502 | Couldn't fetch the origin (404, network error, etc) | Check the URL is reachable; transient — safe to retry |
| `PlanTokenInvalid` | 410 | `--plan-token` was malformed, expired, or already consumed | Re-run the corresponding `... sync-resolve` to mint a fresh token |

### Terminal (session `/spawn`)

These are allow-listed class errors from `@glyphs-ai/terminal`. They have no dedicated policy row, so when they fall through as unmapped safe-name errors the responder uses the fallback status (400 by default). In practice the `/spawn` route surfaces most launch failures as `200 {ok: false, code, error}` rather than throwing.

| code | HTTP | meaning | fix |
|---|---|---|---|
| `NoTerminalFoundError` | 400* | Couldn't find a terminal to spawn the session in | Server-side; check OS terminal config |
| `TerminalSpawnFailedError` | 400* | Terminal spawn failed | Same |
| `UnsupportedPlatformError` | 400* | Operation not supported on this OS | No remedy; cross-platform gap |

*Fallback status; see the note above.

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
