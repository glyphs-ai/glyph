# @glyphs-ai/workflow

> **Tier:** T1 (Modes).

Closed-kind T1 substrate for workflow DAGs in glyph. It owns three
tables — `workflows` / `workflow_nodes` / `workflow_edges` — plus the
entity layer that round-trips them, the Result-native error atoms, and
the `WorkflowNodeRunner` port that callers implement once per
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

`composeWorkflowModule` returns a `WorkflowModule` — a DI container of
use-case instances plus the stateful engine. There is no service facade;
consumers call `module.<useCase>.execute(request)`. The coordinator-callback
mutations and structural reads are surfaced over HTTP (see
[Coord-callback API](#coord-callback-api)); the lifecycle and engine-facing
members are driven by the host, never by the coordinator.

- **Mutation primitives** (coord-callback): `addSubgraph`, `pruneSubgraph`,
  `updateNodeSpec`, `cancelNode`, `finishWorkflow`, `respondHumanNode`. Each is
  independently atomic; structural DAG growth goes through `addSubgraph`.
- **Structural reads**: `getWorkflow`, `getDag`, `getNode`, plus the list /
  aggregate reads `listWorkflows`, `countAwaitingHuman`, and
  `aggregateByOrigin` that back the dashboard's workflow list and badges, and
  the per-node artifact reads `listWorkflowArtifacts` /
  `resolveWorkflowArtifactPath`.
- **Lifecycle / operator**: `createWorkflow` (bootstrap a workflow and its
  initial coordinator node), `cancelWorkflow` (operator cancel, cascades to
  in-flight nodes), `deleteWorkflow` (teardown, optionally purging the workflow
  directory). These are host entry points, not coord-reachable.
- **Engine seam**: `module.engine` is the stateful `WorkflowEngine`. Every
  mutation use-case nudges it post-commit so newly eligible nodes dispatch, and
  hosts `drain()` it on shutdown. `module.close()` drains the engine and closes
  the module-owned SQLite connection.

## Origin + origin_id

Every workflow row carries two first-class routing columns: an `origin`
recording who launched it, and an optional typed `origin_id` naming the
specific external entity within that origin. `origin` is an open string
discriminator (`WorkflowOrigin = string`): `"standalone"` is the
conventional value for direct dashboard / CLI / MCP creation, while
`"schedule"` is stamped by the schedule integration handler and pairs
with the launching schedule's id in `origin_id`. `listWorkflows` takes an
optional `origin` filter so a host can scope a listing to a single origin
and keep integration-owned workflows out of the user's main list.

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

Four-layer DDD tree (domain / application / infrastructure / composition):

```
src/
  domain/                Framework-free entities, value objects, and FSM enums
    workflow/            WorkflowEntity + value objects (status, origin, brief,
                         cancellation, success, failure, id, dag, dispatch
                         readiness, stuck recovery) + the WorkflowRepository port
    node/                Node entity, node id, kind, status, retry, human-node
    edge/                Edge entity
  application/           One use-case per operation (each returns a Result)
    engine/              WorkflowEngine — the in-process dispatch / terminal tick loop
    ports/               WorkflowNodeRunner port + WorkflowRunners (one per kind)
    workflow-public.ts   Shared cross-use-case surface re-exported from domain
    use-case.ts          UseCase interface
  infrastructure/
    drizzle/             Table definitions, mapper, repository, queries, migrations, db open
    file/                WorkflowSandbox — per-workflow directory paths + atomic IO
  workflow-module.ts     composeWorkflowModule(...) composition root → WorkflowModule
  index.ts               public barrel
drizzle/                 generated + hand-written SQL migrations (committed)
README.md                this file
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
    coordinator: makeCoordNodeRunner({ ... }),
    worker:      makeWorkerNodeRunner({ ... }),
    human:       makeHumanNodeRunner({ ... }),
  },
});
```

All three runners live in `packages/api/src/wiring/` because they
bridge `@glyphs-ai/workflow`, `@glyphs-ai/task`, and
`@glyphs-ai/catalog`.

## Coord-callback API

The coord-callback mutation use-cases, plus the per-node `getNode`
structural read, are exposed over HTTP on
`/api/workspaces/:id/workflows/:workflowId/*` so a coordinator agent's task
can grow / inspect the DAG from its own process. HTTP routes forward
`workflowId` from the URL path and nothing else; the substrate's only
lifecycle gate is the workflow's own status — a mutation against a terminal
workflow surfaces the `WorkflowAlreadyTerminal` atom → HTTP 409. Structural
invariants (coord-chain orphan / single-successor, parent-state rules,
sealing-rule rejection on non-`not_started` targets) still apply and surface
as their own typed error atoms.

| Verb     | Path                                       | Use-case         | Body                                                                                                           | Response                                      |
| -------- | ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `GET`    | `/:workflowId/nodes/:nodeId`               | `getNode`        | _none_                                                                                                         | `WorkflowNode`                            |
| `POST`   | `/:workflowId/subgraph`                    | `addSubgraph`    | `{ nodes:[{tempId,kind,spec,existingParents?}], edges:[{from,to}] }` — `from`/`to` are tagged `NodeRef`s        | `{ insertedNodes:[{tempId,nodeId,phase}] }`   |
| `POST`   | `/:workflowId/prune`                       | `pruneSubgraph`  | `{ nodeIds:[…] }` — retract still-`not_started` nodes + adjacent edges                                          | `{ prunedNodeIds:[…], prunedEdges:[{from,to}] }` |
| `PATCH`  | `/:workflowId/nodes/:nodeId/spec`          | `updateNodeSpec` | `{ target:{ kind:"worker"\|"human", …spec fields } }` — partial patch on a `not_started` node | `{ node }` |
| `POST`   | `/:workflowId/nodes/:nodeId/cancel`        | `cancelNode`     | _none_                                                                                                         | `WorkflowNode` (post-cancel projection)   |
| `POST`   | `/:workflowId/finish`                      | `finishWorkflow` | `{ outcome: "succeeded" \| "failed" }`                                                                         | `WorkflowHeader` (post-finish projection) |
| `POST`   | `/:workflowId/nodes/:nodeId/respond`       | `respondHumanNode` | `{ choiceId?, input? }`                                                                                      | `WorkflowNode` (post-respond projection)  |

`NodeRef` is a tagged union:
`{kind:"existing",id}` (resolve to an existing node) or
`{kind:"temp",tempId}` (resolve to a temp node declared in the same
`addSubgraph` batch).

### Error policy

Use-cases return discriminated-union error atoms (keyed on `type`); the host's
route layer maps each atom to an HTTP status:

| Error atom                       | HTTP | Why                                                     |
| -------------------------------- | ---- | ------------------------------------------------------- |
| `WorkflowNotFound`               | 404  | addressing miss                                         |
| `WorkflowNodeNotFound`           | 404  | addressing miss                                         |
| `NodeSpecError`                  | 422  | per-kind spec validation (wraps a typed `cause`)        |
| `EmptyParents`                   | 422  | node declared with no parent                            |
| `WorkflowSubgraphInvalid`        | 422  | structural batch rule (empty / cyclic / unresolved ref) |
| `HumanNodeResponseInvalid`       | 422  | human-node response failed validation                   |
| `WorkflowAlreadyTerminal`        | 409  | mutation against an already-terminal workflow           |
| `WorkflowNodeNotMutable`         | 409  | sealing rule — status disallows the verb                |
| `WorkflowDeleteRequiresTerminal` | 409  | delete attempted on a non-terminal workflow             |
| `WorkflowDagConflict`            | 409  | DAG rule (successor-coord / orphan-coord / parent-state) |
| `WorkflowInvariantViolation`     | 500  | persisted state violates a substrate invariant          |
| `DatabaseUnavailable`            | 503  | SQLite driver fault                                     |
| `WorkflowDirReservationFailed`   | 503  | workflow-directory reservation IO fault                 |

The CLI mirrors the read + mutation surface as `glyph workflow <verb>`
subcommands. Reads: `list`, `show`, `node-show`, `dag`. Operator lifecycle:
`create`, `cancel`, `rm`. Coord-callback mutations: `add-node`, `add-subgraph`,
`add-edge`, `cancel-node`, `finish`, `respond`. The DAG is append-only — there
is no remove or replace verb. Spec payloads are read from `--spec-file <path>`
so multi-line JSON survives shell quoting.
