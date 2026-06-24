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
  coord awake right now" is derived from `workflow_nodes`
  (`hasLiveCoord(nodes)` helper).
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

- **Mutation primitives** (9, coord-callback): `addNode`, `addEdge`,
  `addSubgraph`, `removeNode`, `removeEdge`, `replaceSpec`,
  `cancelNode`, `finishWorkflow`, `respondHumanNode`. Each is
  independently atomic; the substrate has no monolithic-batch API.
- **Structural reads**: `getWorkflow`, `getDag`, `getNode`,
  `getNodeDir`, plus the list / aggregate reads `list`,
  `countAwaitingHumanByWorkflow`, and `aggregateByOriginMetadataKey`
  that back the dashboard's workflow list and badges.
- **Lifecycle / operator**: `createWorkflow` (bootstrap a workflow and
  its initial coordinator node), `cancelWorkflow` (operator cancel,
  cascades to in-flight nodes), `deleteWorkflow` / `purge` (teardown).
  These are host entry points, not coord-reachable.
- **Engine-facing**: `setEngine`, `listEligibleNodeIdsForDispatch`,
  `dispatchAtomic`, and `markNodeTerminal` — the dispatch /
  terminal-write seam the in-memory `WorkflowEngine` drives each tick.
  `runnerFor`, the eligibility scan, and `dispatchAtomic` live in
  `_dispatch.ts`; the service keeps thin delegators.

## Origin + indexed metadata

Every workflow row carries an `origin` (`WorkflowOrigin = standalone |
schedule`) recording who launched it. `standalone` is the default for
direct dashboard / CLI / MCP creation; `schedule` is stamped by the
schedule integration handler. The default `GET /workflows` listing
filters to `standalone` by construction so integration-owned workflows
don't leak into the user's main list.

The substrate ships **one deliberate integration-aware leak**: a
partial index `workflows_schedule_id_idx` on
`json_extract(metadata, '$.scheduleId') WHERE origin = 'schedule'`,
paired with the `WORKFLOW_INDEXED_METADATA` registry in
`workflow-repository.ts` that maps the `(origin = "schedule",
metadataKey = "scheduleId")` pair to that expression. It exists so the
host can answer "which workflows did schedule X create?" via an indexed
`aggregateByOriginMetadataKey` lookup instead of a metadata scan. This
couples the substrate to one convention of one origin
(`schedule.metadata.scheduleId`) on purpose; a new origin does **not**
need its own index unless it needs the same reverse lookup — in which
case extend the registry and add a matching partial index in a
migration. The `(origin, metadataKey)` pairing is intentionally *not*
generalized into a dynamic index API: the set of indexed conventions is
small and explicit.

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

The 9 mutation primitives on `WorkflowService`, plus the per-node
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
| `POST`   | `/:workflowId/nodes`                       | `addNode`        | `{ kind, spec, parents[] }`                                                                                    | `{ nodeId, phase }`                           |
| `GET`    | `/:workflowId/nodes/:nodeId`               | `getNode`        | _none_                                                                                                         | `WorkflowNodeWire`                            |
| `POST`   | `/:workflowId/edges`                       | `addEdge`        | `{ fromNodeId, toNodeId }`                                                                                     | `{ fromNodeId, toNodeId, toPhase }`           |
| `POST`   | `/:workflowId/subgraph`                    | `addSubgraph`    | `{ nodes:[{tempId,kind,spec,existingParents?}], edges:[{from,to}] }` — `from`/`to` are `{nodeId}` or `{tempId}` | `{ insertedNodes:[{tempId,nodeId,phase}] }`   |
| `POST`   | `/:workflowId/nodes/:nodeId/cancel`        | `cancelNode`     | _none_                                                                                                         | `WorkflowNodeWire` (post-cancel projection)   |
| `POST`   | `/:workflowId/finish`                      | `finishWorkflow` | `{ outcome: "succeeded" \| "failed" }`                                                                         | `WorkflowHeaderWire` (post-finish projection) |
| `DELETE` | `/:workflowId/nodes/:nodeId`               | `removeNode`     | _none_                                                                                                         | `204 No Content`                              |
| `DELETE` | `/:workflowId/edges/:fromNodeId/:toNodeId` | `removeEdge`     | _none_                                                                                                         | `204 No Content`                              |
| `PATCH`  | `/:workflowId/nodes/:nodeId/spec`          | `replaceSpec`    | `{ newSpec }`                                                                                                  | `WorkflowNodeWire` (post-replace projection)  |
| `POST`   | `/:workflowId/nodes/:nodeId/respond`       | `respondHumanNode` | `{ choiceId?, input? }`                                                                                      | `WorkflowNodeWire` (post-respond projection)  |

`NodeRefWire` on the wire is a structural-discriminator union — exactly
one of `{nodeId}` (resolve to an existing node) or `{tempId}` (resolve
to a temp node declared in the same `addSubgraph` batch). The route
boundary translates each shape to the substrate's tag-discriminated
`NodeRef` (`{kind:"existing",id}` / `{kind:"temp",tempId}`) before
calling the service.

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
