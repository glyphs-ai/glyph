---
name: software-development-lifecycle
scope: official
description: "Strategy skill for the official/coordinator agent — the engineer → review+designer iterate-to-clean orchestration: case bank, brief templates, placeholder resolution, stop condition, failure-mode coverage"
version: 0.2.0
---

# Glyph Software-Development-Lifecycle Strategy Skill

Strategy: dispatch a single `official/engineer` worker; on success, fan out to parallel `official/reviewer` (MODE: code) + `official/designer` reviewers; if both verdicts come back clean (APPROVE with at most minor findings), sync-poll `gh pr checks` as a CI quality gate — all green → finish succeeded; any red → next engineer iteration with CI context; pending → dispatch a `ci-waiter` (reviewer in MODE: ci) that blocks until CI terminal. Else (any reviewer blocker / major) dispatch the next `official/engineer` iteration with prior verdicts available, and loop. Loaded by the `official/coordinator` agent alongside the generic `official/workflow-coordination` skill at every coord wake-up.

---

## Case bank

Match own direct parents against these cases — exactly one matches per wake-up (the case bank is total over expected shapes; see "Failure-mode coverage"). Unexpected shapes (3 parents, an unknown agent FQN, etc.) are bugs in workflow construction; terminate with `workflow finish --outcome failed --message "coord saw unexpected DAG shape under official/software-development-lifecycle: <describe>"`.

```
CASE "no parents" (initial coord node):
  addSubgraph:
    dev (worker, agent=official/engineer, brief=<template-dev-iter-1>)
       parents = [self]
    next-coord (coordinator, agent=official/coordinator)
       parents = [dev]
  exit

CASE "one parent, worker, agent=official/engineer, status=succeeded":
  addSubgraph:
    review   (worker, agent=official/reviewer, brief=<template-review>)
       parents = [self]
    designer (worker, agent=official/designer, brief=<template-designer>)
       parents = [self]
    next-coord (coordinator, agent=official/coordinator)
       parents = [review, designer]
  exit

CASE "one parent, worker, agent=official/engineer, status in (failed, cancelled)":
  finishWorkflow(failed, "dev iteration ended in {status}")
  exit

CASE "two parents, both worker, agents in {official/reviewer, official/designer}":
  for each parent:
    fetch task:    glyph task show --tid <parent.taskId> --json
    fetch verdict: read <workdir>/artifact/verdict.json (parse per §C of generic skill)
  blockers_and_majors = [
    f for v in verdicts for f in v.findings if f.severity in ('blocker', 'major')
  ]
  if blockers_and_majors is not empty:
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<template-dev-iter-2-plus>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    exit

  # Both reviewers APPROVE — run CI quality gate before declaring success.
  prior_dev = most recent (highest-phase) agent=official/engineer worker node in the DAG
  pr_number = derive from glyph task show --tid <prior_dev.taskId> --json
              (the engineer's success.output and/or activity log carry the
              `gh pr create` URL; parse the PR number from the URL —
              no new engineer contract required)
  ci = `gh pr checks <pr_number> --json name,state,conclusion`
  if every check has conclusion = "success":
    finishWorkflow(succeeded, summary={
      "iterations": <count of dev nodes in DAG>,
      "minor_findings_remaining": <count if any>,
      "ci": "all green"
    })
  elif any check has conclusion in ("failure", "cancelled", "timed_out"):
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<template-dev-iter-2-plus>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    # The dev brief instructs the worker to fetch `gh pr checks --json`
    # itself so the failing-job context flows in without coord pre-digestion.
    exit
  else:  # at least one check still pending — dispatch a ci-waiter
    addSubgraph:
      ci-waiter (worker, agent=official/reviewer, brief=<template-review-ci>)
         parents = [self]
      next-coord (coordinator)
         parents = [ci-waiter]
    exit

CASE "one parent, worker, agent=official/reviewer, status=succeeded" (the ci-waiter terminal):
  # Topologically distinguished from the normal reviewer-in-pair case
  # by single-parent shape: the review + designer pair always lands as
  # two parents on the next coord. A lone reviewer parent is therefore
  # always a ci-waiter dispatched via template-review-ci.
  fetch verdict: read <workdir>/artifact/verdict.json (parse per §C of generic skill)
  if verdict == "APPROVE" and (findings == [] or all minor):
    finishWorkflow(succeeded, summary={
      "iterations": <count of dev nodes>,
      "minor_findings_remaining": <count>,
      "ci": "all green (waited)"
    })
  else:  # REQUEST_CHANGES — CI ended red
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<template-dev-iter-2-plus>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    exit

CASE "one parent, worker, agent=official/reviewer, status in (failed, cancelled)" (ci-waiter failed):
  finishWorkflow(failed, "ci-waiter iteration ended in {status}; coord cannot decide CI state without verdict")
  exit

CASE "two parents, both worker, any status in (failed, cancelled)":
  finishWorkflow(failed, "reviewer iteration ended in {status}; coord cannot decide without verdict")
  exit
```

Use the §B "Batch-mutate the DAG atomically" `add-subgraph` payload shape from the generic skill; substitute `<self-node-id>` with the actual id from the DAG snapshot.

---

## Brief templates

Coord at dispatch time substitutes `${PLACEHOLDER}` slots per the resolution table below; do not paraphrase template prose — workers receive these as their primary contract.

### Template: template-dev-iter-1 (the initial dev call)

```
Implement the feature per the workflow brief.

# Workflow context
- Workflow id: ${WORKFLOW_ID}
- Workflow brief (verbatim from creator):
  ${WORKFLOW_BRIEF}
- Workflow details (verbatim from creator):
  ${WORKFLOW_DETAILS}

# Output expectations
Follow your normal dev workflow (branch, PR, etc.). The coord will pick
up your PR via the workflow DAG; no special output protocol on your end.
```

### Template: template-dev-iter-2-plus (after a review round)

```
Re-implement the feature for iteration ${ITERATION_NUMBER}.

# Workflow context
- Workflow id: ${WORKFLOW_ID}
- Workflow brief (verbatim):
  ${WORKFLOW_BRIEF}
- Workflow details (verbatim):
  ${WORKFLOW_DETAILS}

# Prior iteration outputs (you must fetch these yourself)
- Prior review verdict + narrative:
    glyph task show --tid ${PRIOR_REVIEW_TASK_ID} --json
    then read <workdir>/artifact/verdict.json and <workdir>/artifact/review.md
- Prior designer verdict + narrative:
    glyph task show --tid ${PRIOR_DESIGNER_TASK_ID} --json
    then read <workdir>/artifact/verdict.json and <workdir>/artifact/review.md
- CI state on the PR (in case the prior iteration was waved through by
  reviewers but failed in CI — coord re-dispatches you with the same
  brief so always check):
    gh pr checks ${PR_NUMBER} --json name,state,conclusion,detailsUrl
    For any failure: gh run view <runId> --log-failed | tail -c 2000

# What to do
Address every finding marked severity=blocker or major. Apply your own
judgment on severity=minor findings — fix what you'd fix as a
professional. For any red CI check, fix the underlying breakage in the
same commit set.

Keep working on branch ${BRANCH_NAME} (already-pushed prior iteration
commits are visible; rebase / amend as you see fit).
```

### Template: template-review (MODE: code — same every iteration)

```
MODE: code

Review the latest dev iteration in this workflow.

# Workflow context
- Workflow id: ${WORKFLOW_ID}
- Workflow brief (verbatim):
  ${WORKFLOW_BRIEF}

# What to review
The dev node immediately preceding you in the workflow DAG. Find it via:
  glyph workflow dag --wfid ${WORKFLOW_ID} --json
The dev node is your direct parent. Read dev's task via its taskId, see
what changed, apply your normal review standards.

If this is review iteration 2 or later, fetch the prior review node
(same agent as you, lower phase in the DAG) — read its
<workdir>/artifact/verdict.json to confirm previously-flagged findings
are now addressed.

# Required output protocol
Write to <workdir>/artifact/verdict.json (the substrate auto-harvests
files under <workdir>/artifact/ into the task's success.artifacts, which
is how the next coord wake-up reads your verdict):
{
  "verdict":  "APPROVE" | "REQUEST_CHANGES",
  "findings": [
    {
      "id":       "F1",                                       // unique within this verdict
      "severity": "blocker" | "major" | "minor",
      "summary":  "<≤200 chars, single line>",
      "detail":   "<free-form, any length>"
    }
  ]
}

Validation rules:
- verdict == "APPROVE"           ⇒ findings MAY be [] OR contain only "minor" items
- verdict == "REQUEST_CHANGES"   ⇒ findings MUST contain ≥1 "blocker" or "major"
- findings[].id must be unique within this verdict

Coord decision rule (so you understand the impact):
- All verdicts APPROVE with only minor findings → CI quality gate runs
  next; all-green CI → workflow finishes succeeded
- Any blocker/major → next dev iteration dispatched, current findings
  propagated to next dev brief (it will read your verdict.json itself)

Optionally write <workdir>/artifact/review.md for free-form narrative.
The next dev iteration will read it for context if produced.
```

### Template: template-designer (same every iteration)

```
Review the latest dev iteration's UI / UX in this workflow.

# Workflow context
- Workflow id: ${WORKFLOW_ID}
- Workflow brief (verbatim):
  ${WORKFLOW_BRIEF}

# What to review
The dev node immediately preceding you in the workflow DAG. Find it via:
  glyph workflow dag --wfid ${WORKFLOW_ID} --json
Apply your normal frontend / design review standards.

If this is designer iteration 2 or later, fetch the prior designer node
(same agent as you, lower phase) and confirm previously-flagged findings 
are resolved.

# Required output protocol
Identical to review's protocol (<workdir>/artifact/verdict.json + optional
<workdir>/artifact/review.md). See template-review above for the schema
and validation rules.
```

### Template: template-review-ci (MODE: ci — CI quality-gate watcher)

```
MODE: ci

Block on the PR's automated checks until terminal, then write a verdict
the coordinator unions with the prior code-review and design-review
verdicts.

# Workflow context
- Workflow id: ${WORKFLOW_ID}
- Workflow brief (verbatim):
  ${WORKFLOW_BRIEF}
- PR number: ${PR_NUMBER}
- Repository: glyphs-ai/glyph

# What to do
1. Run `gh pr checks ${PR_NUMBER} --watch` with a 30-minute
   process-level timeout. On timeout, write a timeout verdict per the
   output protocol below and exit.
2. On terminal, capture per-job state:
     gh pr checks ${PR_NUMBER} --json name,state,conclusion,detailsUrl
3. For any check whose conclusion is in (failure, cancelled, timed_out),
   fetch the failing job's tail (≤2 KB) from the actually-failing job
   (not the whole workflow's log):
     gh run view <runId> --log-failed | tail -c 2000
   Embed the tail in the corresponding finding's `detail` field.
4. Do NOT read the PR diff. Do NOT post inline review comments. Do NOT
   make merge / deploy decisions. Do NOT auto-retry flaky CI runs.

# Required output protocol
Write to <workdir>/artifact/verdict.json (substrate auto-harvests
artifact/ → success.artifacts → coord reads):
{
  "verdict":  "APPROVE" | "REQUEST_CHANGES",
  "findings": [
    {
      "id":       "ci-<job-name>",
      "severity": "blocker" | "major" | "minor",
      "summary":  "<job name + conclusion + ≤200 chars>",
      "detail":   "<failing job log tail (≤2 KB) + detailsUrl>"
    }
  ]
}

Mapping rules:
- Every check conclusion = "success" ⇒ verdict = "APPROVE",
  findings = []
- Any conclusion in ("failure", "cancelled", "timed_out") ⇒
  verdict = "REQUEST_CHANGES", one finding per failing check,
  severity = "blocker" (CI failure blocks merge)
- 30-minute timeout fired before terminal ⇒
  verdict = "REQUEST_CHANGES", one finding id = "ci-timeout",
  severity = "major"

Coord decision rule (so you understand the impact):
- verdict APPROVE → workflow finishes succeeded
- verdict REQUEST_CHANGES → next dev iteration dispatched with this
  verdict as context (dev fetches it itself per its brief)
```

---

## Placeholder resolution table

Plain string replacement; placeholders with no value (e.g. `${WORKFLOW_DETAILS}` when the creator passed nothing) substitute the empty string rather than leaving the literal `${...}` in the dispatched brief.

| Placeholder | Source | Notes |
| --- | --- | --- |
| `${WORKFLOW_ID}` | `workflow.id` from `glyph workflow show` | string |
| `${WORKFLOW_BRIEF}` | `workflow.brief` | verbatim, no rewriting |
| `${WORKFLOW_DETAILS}` | `workflow.details` (may be `null` → emit empty string) | verbatim |
| `${ITERATION_NUMBER}` | count of `official/engineer` worker nodes already in the DAG, +1 | integer; `template-dev-iter-2-plus` only |
| `${PRIOR_REVIEW_TASK_ID}` | `taskId` of the most recent `agent=official/reviewer` worker parent of the prior coord (the reviewer-in-pair from the previous round, NOT a ci-waiter) | string; `template-dev-iter-2-plus` only |
| `${PRIOR_DESIGNER_TASK_ID}` | `taskId` of the most recent `agent=official/designer` worker parent of the prior coord | string; `template-dev-iter-2-plus` only |
| `${BRANCH_NAME}` | derived from the prior dev task: parse `pr_number` from `glyph task show --tid <prior_dev.taskId> --json` (its `success.output` and/or activity log carry the `gh pr create` URL), then `gh pr view <pr_number> --json headRefName -q '.headRefName'` | string; `template-dev-iter-2-plus` only — replaces the legacy `<task-workdir>/branch.txt` convention, which is dropped |
| `${PR_NUMBER}` | derived from the prior dev task: parse PR number from `glyph task show --tid <prior_dev.taskId> --json` (its `success.output` and/or activity log carry the `gh pr create` URL) | integer; `template-dev-iter-2-plus` and `template-review-ci` |

`${PRIOR_*_TASK_ID}` lookups use the "Find prior-iter siblings" snippet from the generic skill §B (same agent FQN, lower phase). For `${PRIOR_REVIEW_TASK_ID}` specifically, restrict the lookup to reviewer nodes that paired with a designer sibling — i.e. ignore `ci-waiter` reviewer nodes (single-parent shape per the case bank) so the dev brief points at the latest *code* review verdict, not the latest CI watcher.

---

## Stop condition

Trigger `finishWorkflow(succeeded, ...)` in the "two parents, both reviewers" case when both verdicts parse cleanly per §C, the union of findings filtered to `severity in ('blocker', 'major')` is empty, AND the CI quality gate is green (either inline via `gh pr checks --json` showing every check `conclusion = "success"`, or via a subsequent `ci-waiter` whose `verdict.json` is `APPROVE`). The success `summary` records `iterations` (count of `official/engineer` nodes in the final DAG), `minor_findings_remaining` (visibility — the work ships with them outstanding), and `ci` (`"all green"` or `"all green (waited)"`).

No hard iteration cap is baked into this strategy; coord uses its judgment to call `finishWorkflow(failed, "convergence stalled — N iterations and still seeing the same finding category")` when iteration is no longer productive (e.g. the same blocker keeps reappearing, CI keeps flaking on the same job).

---

## Failure-mode coverage

Every `(parent role, parent terminal status)` cell on every expected parent role matches exactly one case in the case bank — verify here when editing.

| Coord wake-up shape | Parent role | Parent status | Matched case | Action |
| --- | --- | --- | --- | --- |
| 0 parents (initial coord node) | — | — | "no parents" | addSubgraph dev + next-coord |
| 1 parent | `official/engineer` worker | `succeeded` | "one parent, dev, succeeded" | addSubgraph review + designer + next-coord |
| 1 parent | `official/engineer` worker | `failed` | "one parent, dev, failed/cancelled" | finish(failed, "dev iteration ended in failed") |
| 1 parent | `official/engineer` worker | `cancelled` | "one parent, dev, failed/cancelled" | finish(failed, "dev iteration ended in cancelled") |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, `gh pr checks` all green | "two parents, both reviewers" → CI sub-case all-green | finish(succeeded, ci="all green") |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, `gh pr checks` any red | "two parents, both reviewers" → CI sub-case any-red | addSubgraph next dev iter (dev brief instructs it to fetch CI failure context) |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, `gh pr checks` any pending | "two parents, both reviewers" → CI sub-case pending | addSubgraph ci-waiter (reviewer MODE: ci) + next-coord |
| 2 parents | both reviewers (review + designer) | both `succeeded`, any verdict carries blocker/major | "two parents, both reviewers" → blockers/majors path | addSubgraph next dev iter |
| 2 parents | reviewer | `failed` | "two parents, any failed/cancelled" | finish(failed, "reviewer iteration ended in failed") |
| 2 parents | reviewer | `cancelled` | "two parents, any failed/cancelled" | finish(failed, "reviewer iteration ended in cancelled") |
| 2 parents | reviewer | `succeeded` but `verdict.json` missing / unparseable | "two parents, both reviewers" → §C parse failure | finish(failed, "reviewer <agent> did not produce valid verdict.json") |
| 1 parent | `official/reviewer` worker (ci-waiter) | `succeeded`, verdict APPROVE | "one parent, reviewer, succeeded" (ci-waiter terminal) | finish(succeeded, ci="all green (waited)") |
| 1 parent | `official/reviewer` worker (ci-waiter) | `succeeded`, verdict REQUEST_CHANGES | "one parent, reviewer, succeeded" (ci-waiter terminal) | addSubgraph next dev iter |
| 1 parent | `official/reviewer` worker (ci-waiter) | `failed` | "one parent, reviewer, failed/cancelled" (ci-waiter failed) | finish(failed, "ci-waiter iteration ended in failed") |
| 1 parent | `official/reviewer` worker (ci-waiter) | `cancelled` | "one parent, reviewer, failed/cancelled" (ci-waiter failed) | finish(failed, "ci-waiter iteration ended in cancelled") |

## Agent compatibility statement

The case bank and brief templates above were validated against:

| Agent FQN | Minimum AGENTS.md version |
| --- | --- |
| `official/engineer` | 0.2.0 |
| `official/reviewer` | 0.2.0 |
| `official/designer` | 0.2.0 |
| `official/coordinator` | 0.1.2 |

When any of those agents publishes a new minor or major version, re-read its `AGENTS.md` and bump this strategy's version if any template needs updating (per `official/workflow-coordination` §E item 6). Coord uses this list at runtime pre-flight (per `official/workflow-coordination` §D) to decide whether the template + agent are still in sync.
