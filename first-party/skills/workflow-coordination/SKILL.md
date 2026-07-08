---
name: workflow-coordination
scope: official
description: "Generic workflow-coordinator framework — operating model, DAG introspection patterns, verdict.json schema, brief-plumbing meta-pattern, and authoring guidance for strategy skills"
version: 0.5.1
---

# Glyph Workflow Coordination Skill

The framework every workflow coordinator wake-up loads: how to read the DAG, what schema reviewer workers emit in `verdict.json`, how to plumb context into worker briefs, and how to author a sibling strategy skill. The case bank, brief templates, and stop condition for any given workflow live in a sibling **strategy skill**; the scaffolding here is strategy-agnostic.

CLI invocations cited below (`workflow show`, `dag`, `node-show`, `add-subgraph`, `prune-subgraph`, `finish`, `task list`, `task show`) are stable command names — consult your catalog's CLI skill for exact flags.

---

## §A — Operating model

```
1. Read own node id from the task spec / env
2. Read workflow header:           glyph workflow show     $WF --json
3. Read full DAG:                  glyph workflow dag      $WF --json
4. Identify own parents:           edges where to == own node id
5. Identify selected strategy:
   - read workflow.metadata.strategy if set
   - else read workflow.brief for an explicit hint
   - else fall back to the only strategy declared in the coord agent's deps
6. Load the corresponding strategy skill's case bank (see §B in that skill)
7. Match own parents against the case bank, execute the matching case
8. Log decision + reasoning to
   $GLYPH_WORKFLOW_DIR/coord-decisions/<utc-iso-timestamp>-$GLYPH_NODE_ID.md
   (auto-named so concurrent / out-of-order wake-ups never collide;
   colons in the ISO timestamp are replaced with dashes for
   cross-platform filename safety — e.g.
   2026-06-09T15-34-58Z-node_abc123.md)
9. Exit (coord run terminates; substrate detects task terminal;
   next coord wake-up only happens when its own future parents complete)
```

- One wake-up = one decision = one mutation. Use `add-subgraph` OR `finish`. Never loop waiting for parents — the substrate re-wakes coord when its parents land terminal.
- Re-read every identifier from the DAG snapshot every wake-up. Do not cache parent ids, task ids, or branch names across wake-ups. The DAG IS the state.
- The strategy skill owns the case bank; the scaffolding here is universal. Do not look for concrete cases in this skill.

### Reading prior decisions

Past wake-ups' decision files live alongside mine under `$GLYPH_WORKFLOW_DIR/coord-decisions/`; I can `ls` the directory to enumerate them. Filenames are timestamp-prefixed so chronological order is the directory's natural sort — no separate index file is needed. Strategy-specific patterns commonly want this: iteration counters ("how many times have I taken case X so far?"), backoff ("did I just try this and fail on the previous wake-up?"), or audit-trail reconstruction. Prior decision files are read-only from a strategy-discipline standpoint — consult them, never mutate them; the directory is append-only across the workflow's lifetime.

### Strategy selection details

Resolve step 5 in priority order:

1. `workflow.metadata.strategy` — explicit strategy FQN set by the workflow creator (e.g. `"<catalog>/<strategy-short-name>"`).
2. An explicit hint inside `workflow.brief` (e.g. `strategy: acme/research-synth`).
3. The sole strategy among the coord agent's `dependencies.skills` when exactly one is declared.

If none of the three yields a strategy, terminate: `workflow finish --outcome failed --message "coord could not select a strategy: no metadata, no brief hint, and the coord agent declares multiple strategy skills"`.

---

## §B — DAG introspection patterns

Snippets below assume `$DAG` and `$WF` hold the JSON fetched per §A steps 2–3. Parent order is not significant; downstream classification keys on `(kind, agent, status)`.

### Find own parents

```
SELF=$OWN_NODE_ID
PARENT_IDS=$(jq -r --arg self "$SELF" \
  '.edges[] | select(.to == $self) | .from' <<<"$DAG")
```

### Classify a parent: (kind, status, agent)

For each parent id, pull the node from the DAG. Every classifier field comes straight off the node:

```
for PID in $PARENT_IDS; do
  NODE=$(jq --arg id "$PID" '.nodes[] | select(.id == $id)' <<<"$DAG")
  KIND=$(jq -r '.kind' <<<"$NODE")          # "worker" | "coordinator"
  STATUS=$(jq -r '.status' <<<"$NODE")      # "succeeded" | "failed" | "cancelled" | ...
  AGENT=$(jq -r '.spec.agent // empty' <<<"$NODE")
done
```

The 3-tuple `(kind, status, agent)` is the case-bank classifier key. `agent` is empty for `kind: "coordinator"` nodes. A DAG node carries **no** task id: a worker node maps to zero-or-more task runs (one per dispatch / retry), resolved by origin — never stored on the node.

### Resolve a worker node's task run(s)

A worker node's tasks are dispatched with `origin: "workflow"`, `originId: <nodeId>`. List them — newest-first — with the origin filter; the head of the list is the latest run (empty until the node has been dispatched):

```
TASKS=$(glyph task list --origin workflow --origin-id "$PID" --json)
LATEST_TASK_ID=$(jq -r '.[0].id // empty' <<<"$TASKS")
```

Read that run's verdict via `glyph task show "$LATEST_TASK_ID" --json` (workers stay workflow-unaware — see §D).

### Find prior-iter siblings (same agent, lower phase)

Nearest sibling with the same `spec.agent` and a lower `phase`, then its latest task run via the same origin lookup:

```
PRIOR=$(jq -r --arg agent "$WORKER_AGENT" --argjson myPhase "$MY_PHASE" '
  [ .nodes[]
    | select(.spec.agent == $agent and .phase < $myPhase) ]
  | sort_by(.phase) | last // empty | .id' <<<"$DAG")
PRIOR_TASK_ID=$(glyph task list --origin workflow --origin-id "$PRIOR" --json \
  | jq -r '.[0].id // empty')
```

The strategy writes `${PRIOR_*_TASK_ID}` into the next worker's brief; the worker fetches the prior `verdict.json` itself via `glyph task show` (workers stay workflow-unaware — see §D).

### Batch-mutate the DAG atomically via add-subgraph

Use `glyph workflow add-subgraph` with `tempId` references so every node + edge in a fan-out lands in a single transaction. Specific contents are strategy-driven; the SHAPE is universal:

```jsonc
{
  "nodes": [
    { "tempId": "<role-a>", "kind": "worker", "existingParents": ["<self-node-id>"],
      "spec": { "agent": "<agent-fqn>", "brief": "<substituted template>", "details": null } },
    { "tempId": "<role-b>", "kind": "worker", "existingParents": ["<self-node-id>"],
      "spec": { "agent": "<agent-fqn>", "brief": "<substituted template>", "details": null } },
    { "tempId": "coord",    "kind": "coordinator",
      "existingParents": ["<self-node-id>"],           // REQUIRED: chain the new coord onto self (see rule 3 below)
      "spec": { "agent": "<your-coord-agent-fqn>" } }
  ],
  "edges": [
    { "from": { "tempId": "<role-a>" }, "to": { "tempId": "coord" } },
    { "from": { "tempId": "<role-b>" }, "to": { "tempId": "coord" } }
  ]
}
```

The substrate resolves the `tempId`s within the transaction and returns the assigned node ids in `insertedNodes[].nodeId`. Three universal rules:

1. Every fan-out MUST end in a `next-coord` whose parents are the newly-inserted workers (otherwise the branch dead-ends).
2. Exactly one `add-subgraph` per wake-up (splitting a fan-out across two CLI calls leaves a half-formed DAG and may re-wake the wrong coord).
3. The `next-coord` MUST list the currently-running coord's node-id in its `existingParents`. An intra-batch edge from a worker into `next-coord` is NOT enough on its own — the substrate enforces a coord-to-coord chain (a new coord must have at least one coord parent) to keep the DAG frontier connected. The `next-coord` ends up with mixed parents: `[<self-node-id>, ...worker-tempIds-via-edges]`, and its phase is `max(parent-phases) + 1`.

### Common `add-subgraph` rejections

When `glyph workflow add-subgraph` fails, the error `type` names the family and `reason.kind` names the specific invariant. Read both before retrying; guessing burns wake-ups.

**`WorkflowDagConflict` — the DAG shape is legal on its own but violates a coord-chain / parent-state rule:**

| `reason.kind` | What tripped it | Forward fix |
|---|---|---|
| `orphanCoordInsert` | New coord node has no coord parent (workers-only in `existingParents` + edges). | Add `existingParents: ["<self-node-id>"]` to the `next-coord` node. |
| `successorCoordExists` | Self already has a coord-kind child in the DAG. | The wake-up is racing an earlier decision. Re-read the DAG (`glyph workflow dag`) and finish or observe instead of re-inserting. |
| `parentState` | A referenced existing parent is `failed` or `cancelled`; workers/humans can't attach to non-successful parents. | Route to the strategy's failure/cancellation case (typically `workflow finish --outcome failed`). |
| `invariant` | Post-insert the DAG would have zero, or non-coord, or multiple leaves. | The subgraph must leave the DAG with exactly one leaf and it must be a coord. Add the missing `next-coord` (or fix its wiring). |

**`WorkflowSubgraphInvalid` — the subgraph payload itself is malformed:**

| `reason.kind` | What tripped it | Forward fix |
|---|---|---|
| `empty` | Neither nodes nor edges submitted. | Compose a real subgraph; empty mutations are not valid wake-up actions. |
| `tempIdInvalid` | A `tempId` is empty, duplicated, or otherwise malformed. | Use unique, non-empty `tempId`s within the payload. |
| `tempParentless` | A temp node has no incoming edge from any parent (existing or temp). | Give the temp node an `existingParents` entry or an edge from another temp. |
| `nodeRefUnresolved` | An edge or `existingParents` entry references a `tempId` or existing node id that isn't in the payload / DAG. Look at `reason.refKind` (`"temp"` or `"existing"`) to see which side. | Fix the reference; make sure the referenced node id is present in `nodes` (for temp refs) or already in the workflow DAG (for existing refs). |
| `cyclic` | An edge would create a cycle in the resulting DAG. | Rework the subgraph so new nodes strictly extend the frontier downstream. |
| `multipleCoordTemps` | Payload contains more than one coord-kind temp node. | Exactly one `next-coord` per `add-subgraph`; split additional coords into future wake-ups. |

**`WorkflowNodeNotMutable` — the target of an `edges[].to` pointing at an existing node has already started (only `not_started` nodes accept new incoming edges):**

Don't rewrite in-flight nodes; insert a fresh temp node and connect the new work through it.

### Retract a mis-planned fan-out via prune-subgraph

`add-subgraph`'s structural inverse. When a wake-up realizes a batch it queued is wrong — but the nodes haven't started yet — retract them instead of letting dead work dispatch. Use `glyph workflow prune-subgraph <wf> --spec-file <path>` with a body naming the node ids to remove:

```jsonc
{ "nodeIds": ["<node-id-a>", "<node-id-b>"] }
```

The substrate removes those nodes **and every edge touching them** in one transaction and returns `{ prunedNodeIds, prunedEdges }`. It is all-or-nothing: if any check below trips, nothing is removed. Three constraints follow from keeping the surviving DAG connected and coord-anchored:

- Only `not_started` nodes are prunable (a node that already dispatched is real work — cancel it via `cancel-node`, don't prune it).
- The phase-0 bootstrap coordinator can never be pruned.
- After removal, every surviving non-root node must still have a parent, and every surviving non-root coordinator must still have a coordinator parent.

**`WorkflowPruneRejected` — the prune batch was refused; `reason.kind` names why:**

| `reason.kind` | What tripped it | Forward fix |
|---|---|---|
| `nodeNotFound` | A requested id isn't in this workflow. | Re-read the DAG (`glyph workflow dag`); prune only ids that exist. |
| `nodeNotStarted` | A target has already started (`ready` / `running` / terminal). `reason.status` shows which. | Leave started nodes alone; `cancel-node` an in-flight worker instead. |
| `rootCoordProtected` | A target is the phase-0 bootstrap coordinator. | Never prune the root; it anchors the whole DAG. |
| `orphan` | Removing the batch would strand a surviving node with no parents. `reason.nodeId` is the would-be orphan. | Include the orphan in the same prune batch, or keep the parent it depends on. |
| `coordChainBroken` | A surviving coordinator would keep only worker parents (its coord parent was pruned). `reason.nodeId` is that coord. | Prune the dependent coord in the same batch, or keep a coord parent for it. |

---

## §C — verdict.json schema (universal)

Reviewer workers (any worker whose output a coord parses to decide "continue or finish") write a `verdict.json` to `<workdir>/artifact/verdict.json` (the substrate auto-harvests files under `<workdir>/artifact/` into the task's `success.artifacts`, which is what makes them visible to coord wake-ups and to the dashboard Artifacts tab). Every strategy that uses reviewer parents consumes the verdict via this schema.

```
verdict.json schema:
  {
    "verdict":  "APPROVE" | "REQUEST_CHANGES",
    "findings": [
      { "id":       string,                              // unique within this verdict
        "severity": "blocker" | "major" | "minor",
        "summary":  string,                              // ≤200 chars, single line
        "detail":   string                               // free-form, any length
      }
    ]
  }
```

Parse rules for coord:

- `verdict == "APPROVE"` ⇒ findings MAY be `[]` OR contain only `"minor"` items
- `verdict == "REQUEST_CHANGES"` ⇒ findings MUST contain ≥1 `"blocker"` or `"major"`
- `findings[].id` must be unique within this verdict
- Missing severity on a finding ⇒ treat as `"major"` (conservative: do not silently skip)
- Treat missing `findings` array as `[]`
- On parse failure: `workflow finish --outcome failed --message "reviewer <agent> did not produce valid verdict.json"` and exit

Strategy skills SHOULD re-quote this schema (verbatim, or as a worked example with concrete sample values) inside their reviewer brief templates so the worker receives the schema in its brief and need not load this skill.

---

## §D — Brief assembly

Treat workers as pure specialists: they MUST NOT depend on any workflow-specific skill or know they are inside a workflow. All workflow context reaches them via the task brief coord writes when dispatching them.

### How coord assembles briefs

Coord reads the full workflow context — the creator's brief and details, the current DAG state, parent outputs, iteration history — and assembles a brief tailored to the worker's specific task and the current situation. This is NOT rigid template substitution; coord uses judgment about emphasis, ordering, and what context is most relevant given why this worker is being dispatched.

### What a good brief contains

- **The workflow's original goal** — from `workflow.brief` and `workflow.details`. Workers need to understand the big picture to do their job well.
- **What the worker needs to do THIS iteration specifically** — first implementation? Fixing reviewer blockers? Fixing CI failures? Acting on human feedback? The brief's framing should match the reason for dispatch.
- **Where to find prior outputs** — concrete fetch instructions (task ids, artifact paths) so the worker can read raw verdicts, prior reviews, or CI logs itself. Workers do their own fetching; coord does not pre-digest.
- **The output protocol the worker must follow** — for reviewer workers, the §C `verdict.json` schema (verbatim or as a worked example) plus validation rules. For implementer workers, the expected branch / PR convention.

### What coord MUST NOT put in briefs

- **Technical opinions** — code quality judgments, design choices, fix suggestions. Workers own those domains.
- **Pre-digested findings** — the worker reads the raw `verdict.json` or CI logs itself. Coord points to where the data lives, not what it says.
- **Instructions that belong in the worker's own agent body / skills** — if the agent's AGENTS.md or its depended-on skills already cover a behavior, don't restate it in the brief.
- **Hints about future coord wake-ups** — workers are workflow-unaware.

### Adapting emphasis by dispatch reason

- **First iteration** — emphasize the workflow goal and output expectations. Keep it clean and forward-looking.
- **Fixing reviewer blockers** — lead with the fact that reviewers found issues, point to where findings are, note the branch to continue on.
- **Fixing CI failures** — lead with the CI failure, instruct worker to check `gh pr checks`, note the branch.
- **Post-human-feedback** — include the human's response text as additional direction, frame what the human decided or requested.
- **Post-human-approval** — (coord handles this internally; no worker dispatch needed for approval)

### Pre-flight validation

Before writing the `add-subgraph` payload, SKIM each dispatched agent's `AGENTS.md` (sections: "Required output protocol" / equivalent, "Boundaries", `dependencies.skills`). Compare against the brief being assembled:

- **Output path / protocol drift** — brief references `<workdir>/X` but agent's current AGENTS.md says `<workdir>/artifact/X`. Severity: blocker → coord MUST `finishWorkflow(failed, "template drift: <agent>'s output protocol moved to <new path>; strategy <fqn> v<X.Y.Z> needs re-validation")`.
- **Restated skill content** — brief restates instructions already covered by one of the agent's depended-on skills (e.g. branch naming when the agent's VCS skill is a dep). Severity: warning → log to coord-decisions, continue dispatch.
- **Forbidden behavior** — brief asks for something the agent's "Boundaries" section explicitly forbids. Severity: blocker → finishWorkflow(failed).

Coord does NOT silently drop content to fix drift — coord's job in validation is to detect drift and escalate. Fixing the strategy is the author's job, done out-of-band via a new strategy skill version + re-dispatch.

---

## §E — How to author a strategy skill

A strategy skill is a content-only sibling skill the coord agent loads alongside this one — providing the case bank, brief guidance, and stop condition for one orchestration strategy. Multiple strategy skills coexist; the coord agent picks one per workflow per §A step 5.

### Required frontmatter

```yaml
---
name: <strategy-short-name>          # kebab-case
scope: <your-scope>                  # e.g. official, or your catalog's scope
description: "<one short sentence describing what the strategy orchestrates>"
version: 0.1.0                       # 3-segment semver
---
```

Content-only: **no `dependencies:`** (the coord agent already declares the generic `official/workflow-coordination` skill as a peer dep; adding deps here would shadow that scope), **no `prereqs:`** (the skill body is the entire contract — nothing to install).

### Required body sections (use these exact headings — the coord LLM and lint tooling key on them)

1. **Case bank** — enumerate every parent-classification case. Each case carries the matching predicate on `(kind, status, agent)` tuples of own direct parents (use the §B classifier) plus an action: `addSubgraph: <node list>` (with the new workers + briefs + a trailing `next-coord` per §B) or `finishWorkflow(<outcome>, "<message>")`. Fall-through is forbidden; every reachable parent combination must match exactly one case (see "Failure-mode coverage" below). Note: coord-judgment interventions (e.g. inserting a human node on repeated failures) are meta-actions outside the parent-classification model — they are triggered by coord's own assessment, not by a classifier match, and need not appear as a case predicate.
2. **Brief guidance** — for each worker role the strategy dispatches, describe what the assembled brief should convey. Follow the §D principles: workflow goal, what this worker must do in the current iteration, where to find prior outputs (task ids, artifact paths), and the output protocol the worker must follow. The case bank references guidance sections by name (e.g. `brief-guidance=<engineer-iter>`); coord assembles the actual brief at runtime by reading workflow context and DAG state.
3. **Context sources table** — for each piece of runtime information the briefs reference, document where coord pulls it from (`workflow.id`, `workflow.brief`, a parent worker's latest task id via `task list --origin workflow --origin-id <nodeId>`, DAG-derived counters, artifact paths, etc.). Coord consults this table when assembling briefs to ensure all relevant context is included.
4. **Stop condition** — the explicit predicate that triggers `finishWorkflow(succeeded, ...)`. Strategies without a clean terminal state MUST NOT exist in this catalog.
5. **Failure-mode coverage** — an explicit `(role, terminal status)` matrix mapping each cell to the case that catches it, so a future author editing the case bank can re-check coverage without re-deriving it.
6. **Agent compatibility statement** — at the bottom of the skill body, list each agent the strategy dispatches with the minimum AGENTS.md version it was validated against. When any of those agents publishes a new minor / major version, the strategy author re-reads the agent's AGENTS.md and bumps the strategy's version if any brief guidance needs updating. Coord uses this list at runtime pre-flight (see §D) to decide whether the strategy + agent are still in sync.

### Optional body sections

- **Tempid wiring sketches** — concrete `add-subgraph` JSON payloads for the strategy's common fan-outs, useful for the LLM to anchor output shape.
- **Decision-log shape** — strategy-specific extensions to the generic per-wake-up decision file under `$GLYPH_WORKFLOW_DIR/coord-decisions/` (e.g. iteration counter, blockers-and-majors count).

### Constraints

- Strategy skills MUST NOT redefine the `verdict.json` schema — point at §C (verbatim re-quoting inside a reviewer brief is fine; introducing a different schema is forbidden).
- Strategy skills MUST NOT introduce strategy selection logic — that lives in §A. A strategy skill body assumes "I have been selected; here is what I do".
- Strategy skills MUST NOT compose technical content. Quality bars, fix opinions, and review heuristics live in worker agents; strategy briefs only plumb workflow context and the verdict schema.

---

## §F — Human nodes

Human nodes are gates that pause workflow execution until an external actor responds. The substrate handles all lifecycle mechanics; coord only needs to know how to insert them and read their responses.

### Inserting a human node via add-subgraph

Human nodes use `kind: "human"` in the add-subgraph payload. The spec carries a `prompt` (the question shown to the human), a mandatory `promptStyle` (`"plain"` or `"markdown"` — see below), and optional `choices` (predefined options, max 5):

```jsonc
{
  "nodes": [
    { "tempId": "approval", "kind": "human", "existingParents": ["<self-node-id>"],
      "spec": { "prompt": "...", "promptStyle": "markdown",
                "choices": [{ "id": "approve", "label": "Approve & merge" }, ...] } },
    { "tempId": "coord", "kind": "coordinator",
      "spec": { "agent": "<your-coord-agent-fqn>" } }
  ],
  "edges": [
    { "from": { "tempId": "approval" }, "to": { "tempId": "coord" } }
  ]
}
```

Notes:
- `promptStyle` is mandatory. Set `"markdown"` whenever the prompt uses any formatting (headings, lists, bold/italic, inline code, fenced code blocks, links) — the dashboard renders it via the same in-house markdown renderer the Task Overview and Artifact viewer use. Set `"plain"` when the prompt is a single literal sentence with no markdown intent, and especially when it contains characters a markdown renderer would interpret (asterisks, backticks, underscores in identifiers, square brackets). There is no auto-detection — coord must declare.
- `choices` is optional. When omitted, the human gets only a freeform text input.
- Max 5 choices. The system always provides a freeform input option alongside choices.
- The `prompt` should be self-contained: include enough context for the human to decide without needing to look elsewhere.

### Reading a human node's response

When a coord wakes up with a human-kind parent, read the response from the node's metadata:

```sh
glyph workflow node-show <workflow-id> <node-id> --json
```

The response lives at `metadata.response`:
```jsonc
{
  "choiceId": "approve",     // which choice was selected (absent if freeform-only)
  "input": "optional text"   // freeform input (required when no choiceId)
}
```

### Parent readiness

Human nodes follow worker readiness rules: all parents must be `succeeded` before the human node becomes actionable. A human node's own parent being a coord (i.e. coord inserts it directly) means it becomes ready immediately after coord exits.

---

## Decision log

Each wake-up writes a new file `$GLYPH_WORKFLOW_DIR/coord-decisions/<utc-iso-timestamp>-$GLYPH_NODE_ID.md` capturing: which strategy was selected, which case matched, parent ids + statuses observed, verdicts parsed (if any), and the action taken (`add-subgraph` specifics or `finish` outcome + reason). This is the audit trail for post-mortems on the workflow. Prior wake-ups' decision files remain readable; if a strategy skill calls for consulting decision history (e.g. "did I retry this case last time?"), enumerate the directory in timestamp order. Strategy skills may extend the record with extra fields (iteration counter, blocker/major counts, etc.).
