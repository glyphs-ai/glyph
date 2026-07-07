# Changelog

## 0.3.0 (2026-07-07)

- Rewrite `SKILL.md` as a generalized CLI map (all command groups, not just workflow). New top-level "Command surface at a glance" table indexes every group with a one-line purpose and the reference doc that covers it. Workflow content moved out of `SKILL.md`'s body and into `references/workflow-commands.md` (already existed); the skill body now devotes equal weight to `workspace` / `session` / `task` / `schedule` / `catalog` / `runtime` / server-inspection.
- Add `references/commands.md` — full per-subcommand reference for the non-workflow surface (workspace, session, task, schedule, catalog {agent,skill,mcp}, runtime, server-inspection). Documents flags, HTTP route, body shape, response shape, exit-code notes, and per-command anti-patterns (e.g. `schedule patch --details ""` does NOT clear; use `--clear-details`).
- Add `references/json-shapes.md` — payload shapes returned by `--json`. Covers `Workspace`, `Session`, `Task`, `ActivityItem`, `TerminalResult` (task and workflow arms), `Schedule`, `AgentEntry` + `BlockedReason`, `ResolveManifest` (with `planToken` semantics), `WorkflowHeader`, `WorkflowDag` (`WorkflowNode` + `WorkflowEdge`), `Runtime`, `ServerStatus`. Flags optional-vs-null-vs-absent semantics per field. Cross-links to `error-codes.md` for `BlockedReason` remediation.
- Cross-link every reference doc from `SKILL.md`'s new "References" block; annotate anti-patterns section with a schedule-patch clarification (`--details ""` is treated as omitted, use `--clear-details`).
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
