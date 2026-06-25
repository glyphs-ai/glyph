# Workflow subcommands

`glyph workflow …` is the coordinator-facing surface: it lets a workflow
header live in the substrate, exposes the live DAG, and lets a `kind:
coordinator` task mutate the DAG (add nodes, add edges, replace specs,
cancel, finish) while it runs. Workers don't touch this surface — they
just do their job and exit; the substrate joins their result back to the
DAG node via `task.metadata.workflowNodeId`.

> All examples assume `GLYPH_WORKSPACE=<id>` is set; add
> `--workspace-id <id>` to act on a different workspace.

> **Output / exit-code discipline applies uniformly.** Every subcommand
> below accepts the common `--server / --home / --workspace-id / --output /
> --json` flags, returns table by default and machine-parseable JSON when
> `--json` is passed, and shares the exit-code table documented in
> `SKILL.md` (0 success, 2 usage error, 3 unreachable, 4 server 4xx/5xx).
> Per-command sections below only call out **additional** required /
> optional flags, the HTTP route the command wraps, and the response shape.

---

## Subcommand index

| Subcommand | Purpose | Coord-only? |
| --- | --- | --- |
| [`list`](#glyph-workflow-list) | List workflows in the workspace | no |
| [`create`](#glyph-workflow-create) | Seed a workflow + initial coord node | no |
| [`show`](#glyph-workflow-show) | Print one workflow's header | no |
| [`dag`](#glyph-workflow-dag) | Print the full DAG snapshot | no |
| [`node-show`](#glyph-workflow-node-show) | Print one node's projection | no |
| [`add-node`](#glyph-workflow-add-node) | Insert a single node attached to existing parents | **yes** |
| [`add-subgraph`](#glyph-workflow-add-subgraph) | Insert N nodes + intra-batch edges atomically | **yes** |
| [`add-edge`](#glyph-workflow-add-edge) | Add a single edge between two existing nodes | **yes** |
| [`remove-node`](#glyph-workflow-remove-node) | Delete a `not_started` node (and adjacent edges) | **yes** |
| [`remove-edge`](#glyph-workflow-remove-edge) | Delete a single edge | **yes** |
| [`replace-spec`](#glyph-workflow-replace-spec) | Re-validate + replace a node's opaque spec | **yes** |
| [`cancel`](#glyph-workflow-cancel) | Cancel a running workflow (operator) | no |
| [`cancel-node`](#glyph-workflow-cancel-node) | Cancel a single worker node | **yes** |
| [`finish`](#glyph-workflow-finish) | Flip the workflow terminal | **yes** |
| [`respond`](#glyph-workflow-respond) | Respond to a human-kind node | no |

"Coord-only" is a logical marker — the substrate no longer enforces a
caller-coord authorization gate, so any client with workspace access can
hit these endpoints. Mark mutation-style commands as coord-only in your
own playbook to keep the human-vs-orchestrator boundary explicit.

---

## `glyph workflow list`

- Args: none
- Optional flags:
  - `--q <pattern>` — substring match on the workflow id (maps to the HTTP query slot `q`; escapes SQL `LIKE` metacharacters server-side)
  - `--coordinator-agent <fqn>` — exact match on the workflow's denormalised `coordinator_agent` column (HTTP query: `coordinatorAgent`)
  - `--created-since <iso>` — ISO 8601 lower bound (inclusive) on `created_at` (HTTP query: `createdSince`); same semantics as `task list --created-since`
- Route: `GET /workspaces/:id/workflows`
- Output (table): columns `id | brief | coordinatorAgent | status | createdAt`
- Output (json): `WorkflowHeader[]` — each element omits `iterationCount`
  (the list path skips the per-row DAG fetch; use `show` when you need it)

```sh
glyph workflow list --json | jq '.[] | {id, status, coordinatorAgent}'

# Narrow to one coordinator agent's recent runs:
glyph workflow list \
  --coordinator-agent official/coordinator \
  --created-since     2026-06-01T00:00:00Z \
  --json
```

---

## `glyph workflow create`

- Required flags: `--brief <text>`, `--coord-agent <fqn>`
- Optional flags: `--details <text>`, `--details-file <path>`
- Route: `POST /workspaces/:id/workflows`
- Body: `CreateWorkflowRequest` —
  `{ brief, coordinatorAgent, details? }`
- Output: `WorkflowHeader` (status `running`, `iterationCount: 1` —
  one freshly-created coord node)

```sh
WF=$(glyph workflow create \
       --brief        "Add /healthz endpoint returning {ok:true}" \
       --coord-agent  official/coordinator \
       --json | jq -r '.id')
```

The initial coord node is dispatched by the engine as soon as the row
lands; the coord's wake-up sees a single `not_started` self-parent-less
node and runs the strategy's "no parents" case.

---

## `glyph workflow show`

- Positional: `<workflow-id>`
- Route: `GET /workspaces/:id/workflows/:wfid`
- Output: `WorkflowHeader` with accurate `iterationCount` (count of
  worker dev nodes in the DAG, irrespective of status)

Use over `list` whenever you need iteration count or want a single-row
fetch by id.

---

## `glyph workflow dag`

- Positional: `<workflow-id>`
- Route: `GET /workspaces/:id/workflows/:wfid/dag`
- Output (table): node table (`phase | nodeId | kind | status | agent`)
  followed by edge lines (`from → to`)
- Output (json): `WorkflowDag` —
  `{ header: WorkflowHeader, nodes: WorkflowNode[], edges: WorkflowEdge[] }`

`WorkflowNode.kind` is `"coordinator" | "worker"` (full word on both
write and read paths). `WorkflowNode.spec.kind` mirrors the node kind.
`WorkflowNode.taskId` is filled for worker nodes after dispatch; coord
nodes carry their own `taskId` once dispatched too.

```sh
# Coord's bread-and-butter: read the full DAG, find own parents.
DAG=$(glyph workflow dag "$WFID" --json)
echo "$DAG" | jq --arg me "$NODE_ID" \
  '.edges[] | select(.to == $me) | .from'
```

---

## `glyph workflow node-show`

- Positionals: `<workflow-id> <node-id>`
- Route: `GET /workspaces/:id/workflows/:wfid/nodes/:nid`
- Output: `WorkflowNode` (table mirrors the `dag` node row, plus
  `taskId`)
- Errors: 400 invalid id, 404 not found

Use when you already know a node id (e.g. parent id from `dag`) and want
to skip re-fetching the whole snapshot. Common in coord wake-up when you
need to read a parent's `taskId` to look up its task and verdict.

```sh
# Read a single parent node — get its taskId, then read the verdict.
PARENT_TID=$(glyph workflow node-show \
               "$WFID" "$PARENT_ID" --json | jq -r '.taskId')
glyph task show "$PARENT_TID" --json | jq '.workdir'
```

---

## `glyph workflow add-node`

- Positional: `<workflow-id>`
- Required flags: `--kind <coordinator|worker>`, `--spec-file <path>`
- Optional flags: `--parent-node-ids <id1,id2,...>` (comma-separated; an empty
  list is rejected by the substrate — every non-initial node needs ≥1
  parent)
- Route: `POST /workspaces/:id/workflows/:wfid/nodes`
- Body: `AddNodeRequest` — `{ kind, parents, spec }`; `spec` comes from
  `--spec-file` parsed as JSON
- Output (table): `nodeId | phase`
- Output (json): `AddNodeResponse` — `{ nodeId, phase }`

Spec shape by kind (substrate-side validation; details enforced at write):

```jsonc
// coordinator spec — only field allowed is `agent`
{ "agent": "official/coordinator" }

// worker spec — `agent` required; `brief` and `details` overlay onto
// whatever the workflow header provides
{ "agent": "official/engineer", "brief": "…", "details": "…" }
```

`add-node` is fine for single-parent appends but does NOT support
intra-batch wiring (cannot reference a node that doesn't exist yet). For
"add dev + add coord-after-dev" use `add-subgraph` to keep the operation
atomic.

---

## `glyph workflow add-subgraph`

- Positional: `<workflow-id>`
- Required flags: `--spec-file <path>`
- Route: `POST /workspaces/:id/workflows/:wfid/subgraph`
- Body: `AddSubgraphRequest` — entire payload from `--spec-file`:
  ```jsonc
  {
    "nodes": [
      { "tempId": "n1", "kind": "worker", "existingParents": ["<existing-node-id>"],
        "spec": { "agent": "official/engineer", "brief": "…", "details": "…" } },
      { "tempId": "n2", "kind": "coordinator",
        "spec": { "agent": "official/coordinator" } }
    ],
    "edges": [
      { "from": { "tempId": "n1" }, "to": { "tempId": "n2" } }   // {tempId} resolves within the batch; use {nodeId} for an existing node
    ]
  }
  ```
- Output (table): `tempId | nodeId | phase` per row
- Output (json): `AddSubgraphResponse` —
  `{ insertedNodes: [{ tempId, nodeId, phase }] }`

Substrate rules enforced atomically:
- Every node's `parents` may reference existing-node ids OR tempIds from
  the same batch.
- `edges` use tempIds OR existing ids; both are resolved before insertion.
- No cycles, no orphan coords (every batch with multiple coord-temps must
  have exactly one successor coord per parent group), at-most-one-live-
  coord-per-parent invariant preserved post-insert.

The coord strategies (see `official/workflow-coordination` skill §B) build their
"dev + next-coord" or "review + designer + next-coord" expansions with
this command so the engine sees a self-consistent DAG slice.

---

## `glyph workflow add-edge`

- Positional: `<workflow-id>`
- Required flags: `--from-node-id <id>`, `--to-node-id <id>`
- Route: `POST /workspaces/:id/workflows/:wfid/edges`
- Body: `AddEdgeRequest` — `{ fromNodeId, toNodeId }`
- Output (table): `edge <from> → <to> inserted (toPhase=<n>)`
- Output (json): `AddEdgeResponse` — `{ fromNodeId, toNodeId, toPhase }`

`toPhase` is the destination node's recomputed phase after insertion (an
edge can shift the to-node's phase forward in the topological order). Use
the returned value, not the previously-cached one, if your follow-up
logic depends on phase.

---

## `glyph workflow remove-node`

- Positionals: `<workflow-id> <node-id>`
- Route: `DELETE /workspaces/:id/workflows/:wfid/nodes/:nid`
- Output: `node <node-id> removed from workflow <workflow-id>`

The node must be in `not_started`. Adjacent edges (in & out) are deleted
in the same transaction. Removing a running / terminal node is rejected
with `WorkflowNodeNotMutableError` (400).

---

## `glyph workflow remove-edge`

- Positional: `<workflow-id>`
- Required flags: `--from-node-id <id>`, `--to-node-id <id>`
- Route: `DELETE /workspaces/:id/workflows/:wfid/edges/:from/:to`
- Output: `edge <from> → <to> removed from workflow <workflow-id>`

The destination node must still be `not_started`; removing an edge
feeding a running or terminal node is rejected.

---

## `glyph workflow replace-spec`

- Positionals: `<workflow-id> <node-id>`
- Required flags: `--spec-file <path>`
- Route: `PATCH /workspaces/:id/workflows/:wfid/nodes/:nid/spec`
- Body: `ReplaceNodeSpecRequest` — `{ newSpec }` from `--spec-file`
- Output: `WorkflowNode` (table mirrors `dag`'s node row)

The node's `kind` does not change; `newSpec` is re-validated against the
same kind rules. Used by coord to swap an agent or rewrite a brief on a
node it has already created but not yet dispatched (node must be
`not_started`).

---

## `glyph workflow cancel`

- Positional: `<workflow-id>`
- Optional flags: `--message <text>` (defaults to empty),
  `--kind <user>` (only `"user"` accepted)
- Route: `POST /workspaces/:id/workflows/:wfid/cancel`
- Body: `CancelWorkflowRequest` — `{ cancellation: { kind: "user", message } }`
- Output: `workflow <id> cancelled` + `WorkflowHeader`

Triggers the cascade reconciler: every non-terminal node is cancelled
with reason `"workflow cancelled"`. Use sparingly — coord normally
finishes itself via `finish` instead of being externally cancelled.

---

## `glyph workflow cancel-node`

- Positionals: `<workflow-id> <node-id>`
- Route: `POST /workspaces/:id/workflows/:wfid/nodes/:nid/cancel`
- Output: `node <node-id> cancelled` + `WorkflowNode`

Body is empty (mirrors `task cancel`). Runner-level defaults supply the
reason: a worker node gets `"cancelled by coordinator"`; a coord node
gets `"cancelled by operator (workflow cancel)"`. The reason is stored
on the underlying task entity (`tasks.cancellation.message`); read it via
`glyph task show <taskId>` for worker nodes.

---

## `glyph workflow finish`

- Positional: `<workflow-id>`
- Required flags: `--outcome <succeeded|failed>`
- Mutually exclusive:
  - `--summary <text>` — only with `--outcome succeeded` (sets `success.output`)
  - `--message <text>` — **required** with `--outcome failed` (sets `failure.message`)
- Route: `POST /workspaces/:id/workflows/:wfid/finish`
- Body: `FinishWorkflowRequest`:
  ```jsonc
  // succeeded
  { "outcome": "succeeded", "success": { "output": <string|null> } }
  // failed
  { "outcome": "failed",
    "failure": { "kind": "coordinator", "message": "<reason>" } }
  ```
  `failure.kind` is always `"coordinator"` (the only currently-valid
  arm; future arms are reserved). Don't try to send `"coord"` (the old
  3-letter value) — it is rejected.
- Output: `workflow <workflow-id> finished as <outcome>` + `WorkflowHeader`

Idempotent on re-call with the same outcome (substrate compares and
no-ops); calling with a conflicting outcome returns
`WorkflowAlreadyTerminalError` (400).

---

## Common patterns

### Coord introspection (every wake-up)

```sh
# 1. Workflow header — brief, status, coord agent fqn.
WF_HDR=$(glyph workflow show "$WFID" --json)

# 2. Full DAG snapshot — nodes + edges.
DAG=$(glyph workflow dag "$WFID" --json)

# 3. Direct parents of own node id.
PARENT_IDS=$(echo "$DAG" | jq -r --arg me "$NODE_ID" \
               '.edges[] | select(.to == $me) | .from')

# 4. Per parent: kind / status / agent / taskId.
for P in $PARENT_IDS; do
  echo "$DAG" | jq --arg p "$P" \
    '.nodes[] | select(.id == $p) | {kind, status, agent: .spec.agent, taskId}'
done
```

### Reading a finished worker's verdict

```sh
# Given a parent worker node id, fetch the task workdir then read verdict.json.
TID=$(glyph workflow node-show \
        "$WFID" "$PARENT_ID" --json | jq -r '.taskId')
WD=$(glyph task show "$TID" --json | jq -r '.workdir')
jq . "$WD/artifact/verdict.json"
```

### Batch DAG mutation (the typical coord expansion)

```sh
# Build a subgraph payload that wires dev → next-coord using tempIds.
cat > /tmp/expand.json <<EOF
{
  "nodes": [
    { "tempId": "dev",   "kind": "worker", "existingParents": ["$ME"],
      "spec": { "agent": "official/engineer",
                "brief":   $(printf '%s' "$WORKER_BRIEF" | jq -Rs .),
                "details": $(printf '%s' "$WORKER_DETAILS" | jq -Rs .) } },
    { "tempId": "coord", "kind": "coordinator",
      "spec": { "agent": "official/coordinator" } }
  ],
  "edges": [
    { "from": { "tempId": "dev" }, "to": { "tempId": "coord" } }
  ]
}
EOF

glyph workflow add-subgraph "$WFID" --spec-file /tmp/expand.json --json
```

### Finishing the workflow

```sh
# Success.
glyph workflow finish "$WFID" --outcome succeeded \
  --summary "All reviewers approved with only minor findings remaining."

# Failure (reason required).
glyph workflow finish "$WFID" --outcome failed \
  --message "dev iteration ended in failed; cannot make progress."
```

---

## `glyph workflow respond`

Respond to a human-kind node that is in `running` status.

### Synopsis

```sh
glyph workflow respond <workflow-id> <node-id> [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--choice-id <id>` | Choice id (one of the spec choices; omit for freeform) |
| `--input <text>` | Freeform text input (required when `--choice-id` is not provided) |

### HTTP route

`POST /api/workspaces/:id/workflows/:wfid/nodes/:nid/respond`

### Request body

```jsonc
{ "choiceId"?: string, "input"?: string }
```

### Response

`WorkflowNode` (the updated node after transitioning to `succeeded`)

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | server error / network failure |
| 2 | invalid arguments (missing positional, `--input` required without `--choice-id`) |

### Notes

- The target node must be `kind === "human"` and `status === "running"`
- If `--choice-id` is provided, it must match one of `spec.choices[].id`
- If `--choice-id` is omitted, `--input` is required (non-empty)
- On success the node transitions to `succeeded` and downstream nodes are evaluated

---

## See also

- `official/workflow-coordination` skill — coord's operating model, strategies, brief
  templates, and verdict.json schema. The skill is the contract for what
  *should* be dispatched; this reference documents *how* to dispatch it.
- `SKILL.md` (this skill) — output / exit-code discipline and workspace
  scoping conventions all subcommands inherit.
