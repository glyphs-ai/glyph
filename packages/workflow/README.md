# @glyphs-ai/workflow

> **Tier:** T1 (Modes). See the [tier model](../../docs/architecture.md#tier-model).

Closed-kind T1 substrate for workflow DAGs in glyph. It owns three
tables — `workflows` / `workflow_nodes` / `workflow_edges` — plus the
entity layer that round-trips them, the error catalog, and the
`WorkflowNodeRunner` interface that callers implement once per
`WorkflowNodeKind` and inject at compose time.

## Substrate model

The workflow package is a **T1 substrate** alongside the session and
task substrates. It is a smart DAG database with FSM: a coordinator
agent composes whatever DAG shape it wants by calling **mutation
primitives**, while the substrate enforces structural invariants (no
duplicate id, terminal/running rows sealed, acyclic, exactly one
non-terminal coord) and nothing else. The "shape" of a coord turn is
the coord's prerogative.

- **WorkflowStatus** is 4 values: `running | succeeded | failed |
  cancelled`. `running` is the only non-terminal value; "is the
  coord awake right now" is derived from `workflow_nodes` (a running
  `kind='coordinator'` node).
- **Coordinator** is first-class: every coord run is a
  `kind='coordinator'` node, not a row in a separate table. The
  current coord agent FQN is denormalized into
  `workflows.coordinator_agent` for cheap "who's running this
  workflow" queries.
- **Closed kind enum**: the substrate ships exactly three
  `WorkflowNodeKind` values — `'coordinator'`, `'worker'`, and
  `'human'`. A human node is a gate that pauses execution until
  external input arrives via the `respondHumanNode` API (choice
  selection or free-form input). Adding a new kind is a substrate
  change: extend `WorkflowNodeKind`, add a matching field on
  `WorkflowRunners`, and the compiler walks every `switch (kind)`
  branch until each is handled.

## API surface

`WorkflowService` exposes four method groups. The coordinator-callback
mutations and structural reads are surfaced over HTTP (see
[Coord-callback API](#coord-callback-api)); the lifecycle and
engine-facing methods are driven by the host (`@glyphs-ai/api` wiring +
`@glyphs-ai/server` routes), never by the coordinator.

- **Mutation primitives** (coord-callback): `addSubgraph`, `cancelNode`,
  `finishWorkflow`, `respondHumanNode`. Each is independently atomic;
  structural DAG mutation goes through `addSubgraph`.
- **Structural reads**: `getWorkflow`, `getDag`, `getNode`,
  `getNodeDir`, plus the list / aggregate reads `list`,
  `countAwaitingHumanByWorkflow`, and `aggregateByOrigin`
  that back the dashboard's workflow list and badges.
- **Lifecycle / operator**: `createWorkflow` (bootstrap a workflow and
  its initial coordinator node), `cancelWorkflow` (operator cancel,
  cascades to in-flight nodes), `deleteWorkflow` (teardown, optionally
  purging the workflow directory).
  These are host entry points, not coord-reachable.
- **Engine-facing**: `setEngine`, `listEligibleNodeIdsForDispatch`,
  `dispatchAtomic`, and `markNodeTerminal` — the dispatch /
  terminal-write seam the in-memory `WorkflowEngine` drives each tick.
  `runnerFor`, the eligibility scan, and `dispatchAtomic` live in
  `_dispatch.ts`; the service keeps thin delegators.

## Origin + origin_id

Every workflow row carries two first-class routing columns: an `origin`
recording who launched it, and an optional typed `origin_id` naming the
specific external entity within that origin. `origin` is an open string
discriminator (`WorkflowOrigin = string`): `"standalone"` is reserved
for direct dashboard / CLI / MCP creation and is the default for `GET
/workflows`; `"schedule"` is stamped by the schedule integration handler
and pairs with the launching schedule's id in `origin_id`. The default
listing filters to `standalone` by construction so integration-owned
workflows don't leak into the user's main list.

The `(origin, origin_id)` pair is backed by the partial index
`workflows_origin_pair_idx` on `(origin, origin_id) WHERE origin_id IS
NOT NULL`. It lets the host answer "which workflows did schedule X
create?" via an indexed `aggregateByOrigin({ origin, originIds })`
lookup — a typed column comparison, never a `metadata` JSON scan. The
column is origin-agnostic: a new origin that needs the same reverse
lookup just stamps its own `origin_id` at create time (via
`createWorkflow`'s `originId` option) and queries through the same
primitive — no per-origin index, registry, or `json_extract` expression
to extend. `metadata` stays a free-form, un-indexed bag; the routing
key lives in its own typed column.

## Layout

Standard `packages/_template` shape:

```
src/
  _dag.ts               Pure DAG helpers — topology, parent-readiness, cycle check, NodeRef serialization
  _dispatch.ts          Free dispatch helpers — runnerFor / eligibility scan / dispatchAtomic (service delegates)
  _engine.ts            In-memory WorkflowEngine tick loop (private)
  _helpers.ts           Misc pkg-internal helpers (safeRmDir)
  _stuck-recovery.ts    Stuck-coord retry cap consts (STUCK_RETRY_*) + outcome type
  schema.ts             Drizzle table definitions (private)
  workflow-entity.ts    Row ↔ entity round-trip (header / node / edge)
  workflow-repository.ts Drizzle-backed CRUD (private)
  workflow-service.ts   Mutation primitives, reads, lifecycle + engine seam
  compose.ts            composeWorkflowModule({ dbFile, runners, ... })
  migrations.ts         Inlined migration SQL (applied at compose time)
  testing.ts            openTestWorkflowDb() in-memory test helper
  errors.ts             WorkflowError + concrete subclasses
  validate.ts           Id-grammar / enum-membership guards + coordinator-spec check (pure)
  paths.ts              workflowDir / workflowNodeDir helpers
  types.ts              FSM enums, runner interface, NodeRef + service request/response DTOs
  index.ts              public barrel
drizzle/                generated SQL migrations (committed)
README.md               this file
```

## Wiring

Runners are injected at compose time. All three fields are
non-optional, so a missing runner is a TypeScript compile error rather
than a runtime throw:

```ts
const workflowModule = await composeWorkflowModule({
  dbFile,
  workspaceDir,
  runners: {
    coordinator: makeCoordinatorNodeRunner({ ... }),
    worker:      makeWorkerNodeRunner({ ... }),
    human:       makeHumanNodeRunner({ ... }),
  },
});
```

All three runners live in `packages/api/src/wiring/` because they
bridge `@glyphs-ai/workflow`, `@glyphs-ai/task`, and
`@glyphs-ai/catalog`.

## Coord-callback API

The coord-callback mutation primitives on `WorkflowService`, plus the per-node
`getNode` structural read, are exposed over HTTP on
`/api/workspaces/:id/workflows/:workflowId/*` so a coordinator agent's task
can grow / shrink / inspect the DAG from its own process. HTTP routes
forward `workflowId` from the URL path and nothing else; the
substrate's only lifecycle gate is the workflow's own status — a
mutation against a terminal workflow surfaces
`WorkflowAlreadyTerminalError` → HTTP 409. Structural invariants
(coord-chain orphan / single-successor, parent-state rules,
sealing-rule rejection on non-`not_started` targets) still apply
and surface as their own typed errors.

| Verb     | Path                                       | Service method   | Body                                                                                                           | Response                                      |
| -------- | ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `GET`    | `/:workflowId/nodes/:nodeId`               | `getNode`        | _none_                                                                                                         | `WorkflowNode`                            |
| `POST`   | `/:workflowId/subgraph`                    | `addSubgraph`    | `{ nodes:[{tempId,kind,spec,existingParents?}], edges:[{from,to}] }` — `from`/`to` are tagged `NodeRef`s        | `{ insertedNodes:[{tempId,nodeId,phase}] }`   |
| `POST`   | `/:workflowId/nodes/:nodeId/cancel`        | `cancelNode`     | _none_                                                                                                         | `WorkflowNode` (post-cancel projection)   |
| `POST`   | `/:workflowId/finish`                      | `finishWorkflow` | `{ outcome: "succeeded" \| "failed" }`                                                                         | `WorkflowHeader` (post-finish projection) |
| `POST`   | `/:workflowId/nodes/:nodeId/respond`       | `respondHumanNode` | `{ choiceId?, input? }`                                                                                      | `WorkflowNode` (post-respond projection)  |

`WorkflowNodeRef` is a tagged union:
`{kind:"existing",id}` (resolve to an existing node) or
`{kind:"temp",tempId}` (resolve to a temp node declared in the same
`addSubgraph` batch).

### Error policy

| Substrate class                          | HTTP | Why                                                            |
| ---------------------------------------- | ---- | -------------------------------------------------------------- |
| `WorkflowNotFoundError`                  | 404  | addressing miss                                                |
| `WorkflowNodeNotFoundError`              | 404  | addressing miss                                                |
| `WorkflowEdgeNotFoundError`              | 404  | addressing miss                                                |
| `InvalidWorkflowIdError` / id grammar    | 400  | caller-fixable structural validation                           |
| `WorkflowNodeSpecError` (per-kind)       | 400  | caller-fixable spec validation                                 |
| `EmptyParentsError`                      | 400  | mutation body empty                                            |
| `WorkflowSubgraph*Error`                 | 400/409 | structural batch rules                                      |
| `WorkflowNodeKindShapeError`             | 400  | caller `kind` not a non-empty string                           |
| `WorkflowNodeKindCorruptionError`        | 500  | persisted `kind` value outside the closed enum (corruption)    |
| `WorkflowEnumValueCorruptionError`       | 500  | persisted enum value outside the known vocabulary (corruption) |
| `WorkflowAlreadyTerminalError`           | 409  | CAS conflict — workflow is already terminal                    |
| `WorkflowNodeNotMutableError`            | 409  | sealing rule — status disallows the verb                       |
| `WorkflowEdgeCycleError`                 | 409  | DAG cycle would close                                          |
| `WorkflowRemoveNodeOrphansChildError`    | 409  | delete would orphan a child                                    |
| `WorkflowRemoveEdgeOrphansChildError`    | 409  | delete would orphan the to-node                                |

The CLI surface mirrors the HTTP surface 1:1 — every route has a
matching `glyph workflow <verb>` subcommand: `add-node`, `add-edge`,
`add-subgraph`, `remove-node`, `remove-edge`, `replace-spec`,
`cancel-node`, `finish`, `respond` (the nine mutations), plus `node-show` for the
`getNode` read. Spec payloads are read from `--spec-file <path>` so
multi-line JSON survives shell quoting. See
`packages/cli/src/commands/workflow.ts` for the per-flag rationale.
