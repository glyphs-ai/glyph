# Changelog

## 0.6.0 (2026-07-08)

Backfill previously-undocumented CLI subcommands **and** correct stale schedule route paths that never got updated after PR #52's `schedules/{task,workflow}` kind-split (audited registrar/CLI/routes against docs; no code changes to the CLI or API).

### Added

- `references/commands.md#workflow` — add the `workflow prune-subgraph <wfid>` section (`--spec-file <path>`, `POST …/prune` route, `{ nodeIds }` body, `{ prunedNodeIds, prunedEdges }` response, full failure-mode table). Add the subcommand-map row and bump the count (14 → 15).
- `references/commands.md#schedule` — rewrite the group intro to name the workflow-target variants (`create-workflow` / `patch-workflow` / `list-workflows`) instead of hand-waving them as "only differs in the target.kind field". Add sections for `schedule create-workflow` (`POST …/schedules/workflow`, `--coord-agent` required), `schedule patch-workflow` (`PATCH …/schedules/workflow/:sid`), and `schedule list-workflows` (`GET …/scheduled-workflows[?scheduleId=<sid>]`).
- `references/error-codes.md` — add `WorkflowPruneRejected` (422) row to the Workflows section and a new "WorkflowPruneRejected reasons" subsection with all five `reason.kind` variants (`nodeNotFound`, `nodeNotStarted`, `rootCoordProtected`, `orphan`, `coordChainBroken`).

### Fixed (stale routes from PR #52 kind-split)

Every shared `glyph schedule` subcommand documented a pre-kind-split route (`/schedules/:sid/...`) that no longer exists. The CLI actually hits `/schedules/task/:sid/...` first and falls back to `/schedules/workflow/:sid/...` on 404. All corrected against `packages/cli/src/commands/schedule/{mutate,read}.ts` + `packages/api/src/routes/schedules/`:

- `schedule list`: was `GET /schedules`; real is two parallel calls to `GET /schedules/task` + `GET /schedules/workflow` merged client-side (agent filter maps to `?agent=` on task, `?coordinatorAgent=` on workflow).
- `schedule create`: was `POST /schedules`; real is `POST /schedules/task`.
- `schedule show`: was `GET /schedules/:sid`; real is `GET /schedules/task/:sid` → 404 fallback to workflow.
- `schedule enable` / `disable`: doc claimed dedicated `POST .../enable` / `.../disable` routes. **Those routes do not exist.** The CLI PATCHes `{enabled: true|false}` (task → workflow fallback). Doc rewritten to match.
- `schedule patch`: added "task-kind only" caveat and cross-link to `patch-workflow` (previous wording implied kind was derived from the row, which is misleading since the URL is not).
- `schedule rm`: was `DELETE /schedules/:sid`; real is `DELETE /schedules/task/:sid` → workflow fallback. Also documented `{deletedDispatchCount}` response.
- `schedule run`: was `POST /schedules/:sid/run`; real is `POST /schedules/task/:sid/run` → workflow fallback (returns `Task` or `WorkflowHeader` depending on kind).
- `schedule preview`: was `GET /schedules/:sid/preview`; real is `GET /schedules/task/:sid/preview` → workflow fallback. Also called out the sibling `GET /schedules/preview-cron?cron=&tz=` endpoint (not yet wired to a CLI subcommand).
- `schedule list-tasks`: was `GET /schedules/list-tasks`; real is `GET /scheduled-tasks` (sibling collection of `/tasks`, hardcoded to `origin === "schedule"`).
- `references/commands.md#catalog` — drop the `update` and `patch` rows from the Agent/Skill/MCP shared-shape table. Neither exists in the registrar or the API (`packages/api/src/routes/catalog/{agents,skills,mcps}.ts` expose only GET/POST/DELETE); content replacement lives behind `sync-resolve` → `sync --plan-token`, called out explicitly below the table.
- `references/error-codes.md` — update the `CoordSpecNotEditable` fix cue from `prune`+re-add to `prune-subgraph`+re-add (real command name).

### Chore

- `SKILL.md` — version bump only.

## 0.5.0 (2026-07-08)

Document the `workflow update-spec` command (partial spec patch for `not_started` worker/human nodes).

- `references/commands.md#workflow` — add the `workflow update-spec <wfid> <nid>` section (`--patch` flag, `PATCH …/nodes/:nid/spec` route, body-discriminated `target` union, `{ node }` response, full failure-mode list). Bump the subcommand index + count (13 → 14) and add the subcommand-map row.
- `references/error-codes.md` — add `NodeKindMismatch` (400) and `CoordSpecNotEditable` (400) rows under the Workflows section.
- `SKILL.md` — note `update-spec` in the `workflow` command-surface summary row.

## 0.4.1 (2026-07-08)

Document origin-scoped task listing, tighten the `--origin` contract, and correct the workflow-node task-linkage shape.

- `references/commands.md#task` — document `task list --origin <kind> --origin-id <id>`: both-or-neither flags (partial pair exits `2`), valid kinds `schedule | workflow`, newest-first `Task[]` across all statuses, and the `origin: <kind>:<id>` table scope header. Standalone tasks are returned by default when `--origin` is omitted — no explicit `--origin standalone` is needed (standalone tasks have no `originId`).
- `references/error-codes.md` — add `OriginQueryMalformed` (400, partial origin pair) under Tasks. `--origin` is a closed wire enum (`schedule | workflow`), so an out-of-set value surfaces as the shared `ValidationError` (400).
- Correct the `Task` wire shape in `references/json-shapes.md`: `origin` is the kind alone (`standalone | schedule | workflow`) paired with a top-level `originId`, not a compound `schedule:<sid>` string, and the routing id is **not** nested under `metadata`.
- Kill the `WorkflowNode.taskId` fiction: a DAG node carries **no** `taskId`. `references/commands.md#workflow` (`dag`, `node-show`, `cancel-node`) and `references/json-shapes.md#workflownode` now resolve a node's task run(s) by origin (`task list --origin workflow --origin-id <nodeId>`), and the node's human-response fields are documented under `metadata.response`, not as top-level `responseInput` / `responseChoiceId`.
- `schedule list-tasks` output note now states `origin: "schedule"`, `originId: <sid>` (equivalent to `task list --origin schedule --origin-id <sid>`).

## 0.3.0 (2026-07-07)

Generalize the skill to cover every CLI command group as a first-class citizen.

- Rewrite `SKILL.md` as a generalized CLI map. New top-level "Command surface at a glance" table indexes every group with a one-line purpose and its reference doc. The skill body devotes equal weight to `workspace` / `session` / `task` / `schedule` / `catalog` / `workflow` / `runtime` / server-inspection.
- Add `references/commands.md` — full per-subcommand reference covering all 8 command groups (workspace, session, task, schedule, catalog {agent,skill,mcp}, workflow, runtime, server-inspection) in one file with a shared anchor scheme. Documents flags, HTTP route, body shape, response shape, exit-code notes, and per-command gotchas (e.g. `schedule patch --details ""` does NOT clear — use `--clear-details`).
- Add `references/json-shapes.md` — payload shapes returned by `--json`. Covers `Workspace`, `Session`, `Task`, `ActivityItem`, `TerminalResult` (task and workflow arms), `Schedule`, `AgentEntry` + `BlockedReason`, `ResolveManifest` (with `planToken` semantics), `WorkflowHeader`, `WorkflowDag` (`WorkflowNode` + `WorkflowEdge`), `Runtime`, `ServerStatus`. Flags optional-vs-null-vs-absent semantics per field.
- Rename `references/workflows.md` → `references/playbooks.md`. Goal-oriented CLI plumbing: install-and-verify agent, dispatch-and-wait, monitor task, sync entry, clean up, onboard fresh workspace, create a local agent on the fly.
- Fold `references/workflow-commands.md` into `references/commands.md#workflow` so the workflow subcommand reference lives in the same file and shape as every other command group.
- Workflow surface reflects the current wire:
  - `add-node` and `add-edge` are documented as convenience wrappers over `POST /subgraph` (CLI builds a one-node or one-edge subgraph payload internally).
  - `add-subgraph` edge shape: `edges[].from/to` are `{ kind: "existing", id }` or `{ kind: "temp", tempId }` (matches `NodeRefWire`).
  - `add-node` supports `human` kind (choices optional; omit for freeform text input).
  - `remove-node`, `remove-edge`, `replace-spec` removed — no longer part of the CLI or server surface.
- Update `first-party/agents/coordinator/AGENTS.md` reference to point at `references/commands.md#workflow`.
- Drop coordinator / worker consumer vocabulary from `SKILL.md` and the `workflow` section of `references/commands.md`. The CLI reference now describes the surface neutrally; consumer-role framing (who calls which mutation subcommand) is owned upstream by the strategy skill / orchestrator agent that consumes this CLI.
- Drop the `Coord-only?` column from the `references/commands.md#workflow` subcommand index and the meta paragraph explaining the marker.
- Delete the `Common patterns` section (coord introspection, verdict reading, batch DAG expansion, finish) from `references/commands.md#workflow`. That material duplicated the orchestration playbook that lives upstream in `official/workflow-coordination`; the CLI reference is per-subcommand only.
- Drop the `packages/server/src/routes/_shared.ts:SAFE_ERROR_NAMES` source-path reference from `references/error-codes.md` (rot-prone internal file coupling); collapse the two-paragraph internal-detail explanation of "where `code` values come from" to a single sentence stating `code` is a stable wire contract, and merge the `When you see no code` edge case into the main table row.
- Add a strict `ready` gate to the "install an agent and make sure it's ready to dispatch" playbook in `references/playbooks.md` (`test "$FINAL" = ready || exit 1`) so the branch cannot silently exit with a still-blocked entry.
- Flip the `--purge` clean-up comment in `references/playbooks.md` from `Don't --purge casually` prohibition to positive guidance: use plain `task rm` for terminal tasks; `--purge` only when the workdir isn't needed.
- Prose polish in `SKILL.md`: delete the meta `What this skill is NOT` and `When to use` sections, rewrite the `Don't…` anti-patterns as positive `Pitfalls`, and move the `Common SSE resume pattern` snippets out into `references/playbooks.md#monitor-a-long-running-task` (single source of truth) with only a pointer left in `SKILL.md`.
- Trim the meta opener in `references/playbooks.md` ("Each playbook is goal-oriented…") to "Copy and adapt."
- No behaviour changes; documentation-only.

## 0.2.2 (2026-06-24)

- Drop the removed `--metadata-file` flag and `metadata?` body field from the `glyph workflow create` reference in `references/workflow-commands.md`. The caller-facing workflow `metadata` input no longer exists on the HTTP `CreateWorkflowBody` or the CLI, so the optional flags are now `--details` / `--details-file` only and the body shape is `{ brief, coordinatorAgent, details? }`.

## 0.2.0 (2026-06-12)

- Unify CLI id-flag naming across the `workflow` and `workspace` verbs in `references/workflow-commands.md`, `references/workflows.md`, and `SKILL.md`. The primary resource id moves to a positional argument (`glyph workflow show <workflow-id>`, `glyph workflow node-show <workflow-id> <node-id>`); the legacy `--wfid` / `--nid` / `--tid` short-flag spellings are gone with no backward-compat alias. Secondary id flags rename to `--from-node-id` / `--to-node-id` / `--parent-node-ids`. The cross-cutting workspace selector renames `--workspace <id>` → `--workspace-id <id>` to match the new convention. Every `glyph workflow …` example in the skill body and the per-subcommand reference now reflects the new shapes; the "Required flags" bullets gain a leading "Positional" / "Positionals" bullet that names the positional arguments explicitly.

## 0.1.1 (2026-06-11)

- Fix `add-subgraph` JSON examples in `references/workflow-commands.md` to match the actual wire shape: `existingParents` (not `parents`), `edges[].from/to` as `NodeRefWire` objects (`{tempId}` / `{nodeId}`, not bare strings), and `AddSubgraphResultWire.insertedNodes` (not `inserted`).
- Update references to the generic coord framework skill: `official/coordinator` → `official/workflow-coordination` (the skill was renamed to disambiguate from the agent of the same name).

## 0.1.0 (2026-06-11)

- Initial release.
