---
name: software-development-lifecycle
scope: official
description: "Strategy skill for the official/coordinator agent — the engineer → review+designer iterate-to-clean orchestration: case bank, brief templates, placeholder resolution, stop condition, failure-mode coverage"
version: 0.3.0
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
    fetch task:    glyph task show <parent.taskId> --json
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
  pr_number = derive from glyph task show <prior_dev.taskId> --json
              (the engineer's success.output and/or activity log carry the
              `gh pr create` URL; parse the PR number from the URL —
              no new engineer contract required)
  ci = `gh pr checks <pr_number> --json name,state,bucket,link`
       # `bucket` is gh's normalised category for each check, one of
       # `pass | fail | pending | skipping | cancel`. `link` is the
       # per-check URL (GitHub Actions form:
       # https://github.com/<owner>/<repo>/actions/runs/<runId>/job/<jobId>).
  if every check.bucket in ("pass", "skipping"):
       # `skipping` is terminal-OK (the job was deliberately skipped, e.g.
       #  conditional `if:` evaluated false); treat as pass for gating.
    addSubgraph:
      approval (human, spec={
        prompt: "<assembled from workflow brief + iteration count + reviewer summary + PR link>",
        choices: [
          { id: "approve", label: "Approve & merge" },
          { id: "changes", label: "Request more changes" },
          { id: "cancel", label: "Cancel workflow" }
        ]
      })
         parents = [self]
      next-coord (coordinator)
         parents = [approval]
    exit
  elif any check.bucket in ("fail", "cancel"):
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<template-dev-iter-2-plus>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    # The dev brief instructs the worker to fetch `gh pr checks --json`
    # itself so the failing-job context flows in without coord pre-digestion.
    exit
  else:  # at least one check.bucket == "pending" — dispatch a ci-waiter
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
    addSubgraph:
      approval (human, spec={
        prompt: "<assembled from workflow brief + iteration count + reviewer summary + PR link + CI waited>",
        choices: [
          { id: "approve", label: "Approve & merge" },
          { id: "changes", label: "Request more changes" },
          { id: "cancel", label: "Cancel workflow" }
        ]
      })
         parents = [self]
      next-coord (coordinator)
         parents = [approval]
    exit
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

CASE "one parent, human, status=succeeded":
  read metadata.response from parent node via:
    glyph workflow node-show $WF <parent-node-id> --json
  if response.choiceId == "approve":
    finishWorkflow(succeeded, summary={
      "iterations": <count of dev nodes in DAG>,
      "minor_findings_remaining": <count if any>,
      "ci": "all green",
      "approved_by": "human"
    })
  elif response.choiceId == "changes":
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<assembled per brief guidance: dev iteration 2+>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    # brief should include the human's input text as additional guidance
    exit
  elif response.choiceId == "cancel":
    finishWorkflow(failed, "cancelled by human")
    exit
  else (freeform only, no choiceId):
    # interpret the input text as guidance, dispatch next dev iteration
    addSubgraph:
      dev (worker, agent=official/engineer, brief=<assembled per brief guidance: dev iteration 2+>)
         parents = [self]
      next-coord (coordinator)
         parents = [dev]
    exit

CASE (coord judgment): workflow is stuck or needs clarification
  # Triggered when coord detects ambiguity, repeated failures on same issue,
  # or design decisions that need human input
  addSubgraph:
    intervention (human, spec={
      prompt: "<describe the problem and what decision is needed>",
      choices: [<relevant options based on situation>]
    })
       parents = [self]
    next-coord (coordinator)
       parents = [intervention]
  exit
```

Use the §B "Batch-mutate the DAG atomically" `add-subgraph` payload shape from the generic skill; substitute `<self-node-id>` with the actual id from the DAG snapshot.

---

## Brief guidance

Coord assembles briefs based on workflow context, DAG state, and parent outputs. The following guidance describes what each brief type should convey — coord adapts emphasis, ordering, and phrasing to the current situation rather than filling rigid templates.

### Brief guidance: dev iteration (first)

The brief should convey:
- The workflow's original goal (from `workflow.brief` and `workflow.details`)
- That this is the first implementation attempt
- Output expectations (branch, PR, etc. — follow the worker's normal dev workflow)

### Brief guidance: dev iteration (2+)

The brief should convey:
- The workflow's original goal
- Which iteration this is and why another iteration is needed
- If from reviewer blockers: what needs fixing (point to where findings are via task ids and artifact paths — don't pre-digest the content)
- If from CI failure: that CI failed, instruct worker to check `gh pr checks`
- If from human feedback: include the human's response text as additional direction
- The branch name to continue on
- Where to find prior verdicts (task ids for fetch)
- CI state instructions: `gh pr checks <pr_number> --json name,state,bucket,link` — for any failing check, how to retrieve logs

### Brief guidance: reviewer

The brief should convey:
- The workflow's goal
- Which dev iteration to review (parent node's task)
- The review MODE (code or ci)
- If iteration 2+: where to find prior review verdict to check for regressions
- The `verdict.json` output protocol (always inline the full schema and validation rules from §C of the generic skill)
- Coord decision rule (so the reviewer understands impact of their verdict)

### Brief guidance: designer

The brief should convey:
- The workflow's goal
- Which dev iteration to review for UI/UX
- If iteration 2+: where to find prior designer verdict
- The `verdict.json` output protocol (same schema as reviewer)

### Brief guidance: ci-waiter

The brief should convey:
- The workflow's goal
- The PR number and repository
- MODE: ci — block on automated checks until terminal
- Detailed instructions for capturing per-job state and log tails
- The `verdict.json` output protocol with CI-specific mapping rules (pass/skipping → APPROVE, fail/cancel → REQUEST_CHANGES with blocker severity)

### Brief guidance: human approval

The prompt should include:
- Brief summary of what was implemented (assembled from workflow brief)
- Iteration count (how many rounds it took)
- PR link
- Reviewer verdict summary (both APPROVE, N minor findings remaining)
- CI status (all green / all green after waiting)

---

## Context sources for brief assembly

When assembling briefs, coord pulls context from these sources. The specific data included depends on the dispatch reason and worker role.

| Context | Source | Notes |
| --- | --- | --- |
| Workflow id | `workflow.id` from `glyph workflow show` | Always included |
| Workflow brief | `workflow.brief` | Always included; verbatim, no rewriting |
| Workflow details | `workflow.details` (may be `null`) | Include when non-empty |
| Iteration number | count of `official/engineer` worker nodes already in the DAG, +1 | Dev iteration 2+ briefs |
| Prior review task id | `taskId` of the most recent `agent=official/reviewer` worker parent of the prior coord (the reviewer-in-pair, NOT a ci-waiter) | Dev iteration 2+ briefs — point worker to where findings live |
| Prior designer task id | `taskId` of the most recent `agent=official/designer` worker parent of the prior coord | Dev iteration 2+ briefs |
| Branch name | derived from the prior dev task: parse `pr_number` from `glyph task show <prior_dev.taskId> --json`, then `gh pr view <pr_number> --json headRefName -q '.headRefName'` | Dev iteration 2+ briefs |
| PR number | derived from the prior dev task: parse PR number from `glyph task show <prior_dev.taskId> --json` (its `success.output` carries the `gh pr create` URL) | Dev iteration 2+, ci-waiter, and human approval prompt |
| Human response | `metadata.response` from human parent node via `glyph workflow node-show` | Dev iteration briefs dispatched after human feedback |

Prior-iter lookups use the "Find prior-iter siblings" snippet from the generic skill §B (same agent FQN, lower phase). For prior review specifically, restrict the lookup to reviewer nodes that paired with a designer sibling — i.e. ignore `ci-waiter` reviewer nodes (single-parent shape per the case bank).

---

## Stop condition

Trigger `finishWorkflow(succeeded, ...)` when a human approval node's response carries `choiceId == "approve"`. The human approval gate is reached after: both reviewer verdicts parse cleanly per §C, the union of findings filtered to `severity in ('blocker', 'major')` is empty, AND the CI quality gate is green (either inline via `gh pr checks --json` or via a subsequent `ci-waiter` whose `verdict.json` is `APPROVE`). The success `summary` records `iterations` (count of `official/engineer` nodes in the final DAG), `minor_findings_remaining` (visibility — the work ships with them outstanding), `ci` (`"all green"` or `"all green (waited)"`), and `approved_by: "human"`.

No hard iteration cap is baked into this strategy; coord uses its judgment to call `finishWorkflow(failed, "convergence stalled — N iterations and still seeing the same finding category")` when iteration is no longer productive (e.g. the same blocker keeps reappearing, CI keeps flaking on the same job). Coord may also insert a human intervention node when it detects ambiguity or repeated failures requiring human judgment.

---

## Failure-mode coverage

Every `(parent role, parent terminal status)` cell on every expected parent role matches exactly one case in the case bank — verify here when editing.

| Coord wake-up shape | Parent role | Parent status | Matched case | Action |
| --- | --- | --- | --- | --- |
| 0 parents (initial coord node) | — | — | "no parents" | addSubgraph dev + next-coord |
| 1 parent | `official/engineer` worker | `succeeded` | "one parent, dev, succeeded" | addSubgraph review + designer + next-coord |
| 1 parent | `official/engineer` worker | `failed` | "one parent, dev, failed/cancelled" | finish(failed, "dev iteration ended in failed") |
| 1 parent | `official/engineer` worker | `cancelled` | "one parent, dev, failed/cancelled" | finish(failed, "dev iteration ended in cancelled") |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, every `gh pr checks` bucket in `("pass", "skipping")` | "two parents, both reviewers" → CI sub-case all-green | addSubgraph human approval + next-coord |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, any `gh pr checks` bucket in `("fail", "cancel")` | "two parents, both reviewers" → CI sub-case any-red | addSubgraph next dev iter |
| 2 parents | both reviewers (review + designer) | both `succeeded`, both verdicts APPROVE w/ no blocker/major, any `gh pr checks` bucket == `"pending"` | "two parents, both reviewers" → CI sub-case pending | addSubgraph ci-waiter + next-coord |
| 2 parents | both reviewers (review + designer) | both `succeeded`, any verdict carries blocker/major | "two parents, both reviewers" → blockers/majors path | addSubgraph next dev iter |
| 2 parents | reviewer | `failed` | "two parents, any failed/cancelled" | finish(failed, "reviewer iteration ended in failed") |
| 2 parents | reviewer | `cancelled` | "two parents, any failed/cancelled" | finish(failed, "reviewer iteration ended in cancelled") |
| 2 parents | reviewer | `succeeded` but `verdict.json` missing / unparseable | "two parents, both reviewers" → §C parse failure | finish(failed, "reviewer <agent> did not produce valid verdict.json") |
| 1 parent | `official/reviewer` worker (ci-waiter) | `succeeded`, verdict APPROVE | "one parent, reviewer, succeeded" (ci-waiter terminal) | addSubgraph human approval + next-coord |
| 1 parent | `official/reviewer` worker (ci-waiter) | `succeeded`, verdict REQUEST_CHANGES | "one parent, reviewer, succeeded" (ci-waiter terminal) | addSubgraph next dev iter |
| 1 parent | `official/reviewer` worker (ci-waiter) | `failed` | "one parent, reviewer, failed/cancelled" (ci-waiter failed) | finish(failed, "ci-waiter iteration ended in failed") |
| 1 parent | `official/reviewer` worker (ci-waiter) | `cancelled` | "one parent, reviewer, failed/cancelled" (ci-waiter failed) | finish(failed, "ci-waiter iteration ended in cancelled") |
| 1 parent | human node | `succeeded`, choiceId="approve" | "one parent, human, succeeded" | finish(succeeded) |
| 1 parent | human node | `succeeded`, choiceId="changes" | "one parent, human, succeeded" | addSubgraph next dev iter + next-coord (include human input as guidance) |
| 1 parent | human node | `succeeded`, choiceId="cancel" | "one parent, human, succeeded" | finish(failed, "cancelled by human") |
| 1 parent | human node | `succeeded`, freeform only (no choiceId) | "one parent, human, succeeded" | addSubgraph next dev iter + next-coord (interpret input as guidance) |
| 1 parent | human node (intervention) | `succeeded` | "(coord judgment)" | interpret response, dispatch appropriate next step |

## Agent compatibility statement

The case bank and brief guidance above were validated against:

| Agent FQN | Minimum AGENTS.md version |
| --- | --- |
| `official/engineer` | 0.2.0 |
| `official/reviewer` | 0.2.0 |
| `official/designer` | 0.2.0 |
| `official/coordinator` | 0.2.0 |

Human node support requires coordinator ≥ 0.2.0 (human node awareness in wake-up loop + brief assembly approach).

When any of those agents publishes a new minor or major version, re-read its `AGENTS.md` and bump this strategy's version if any brief guidance needs updating (per `official/workflow-coordination` §E item 6). Coord uses this list at runtime pre-flight (per `official/workflow-coordination` §D) to decide whether the brief + agent are still in sync.
