# Changelog

## 0.3.3 (2026-07-07)

- Add `type: strategy` to frontmatter. The tag formally invokes the rule-3 naming exception used by the case bank and dispatch templates to name the loading coord agent + worker agent FQNs.

## 0.3.2 (2026-07-07)

- Declare `official/workflow-coordination` and `official/cli` under `dependencies.skills` in the frontmatter; the body already names both.
- Rewrite 0.3.1 CHANGELOG entry forward-only (drop the "Previously ..." framing and the squash-strategy rationale tail).

## 0.3.1 (2026-06-15)

- The approve-choice branch runs `gh pr merge <pr_number> --repo <owner/repo> --squash --delete-branch` before `finishWorkflow(succeeded, ...)`. On merge failure (non-mergeable, push race, branch protection), the workflow finishes `failed` with a clear reason; the PR remains open for manual triage. §Stop-condition prose and §Failure-mode coverage table updated to match. Squash is the merge strategy.

## 0.2.1 (2026-06-12)

- Realign brief templates and the `${PR_NUMBER}` / `${BRANCH_NAME}` placeholder-derivation prose to the new CLI id-flag convention (`packages/cli/README.md` → "Naming conventions"): `glyph task show --tid <id>` → `glyph task show <id>` (positional); `glyph workflow dag --wfid ${WORKFLOW_ID}` → `glyph workflow dag ${WORKFLOW_ID}` (positional). Documentation-only change.

## 0.2.0 (2026-06-12)

- **CI quality gate**: extend the "two parents, both reviewers" case with an APPROVE sub-case that runs `gh pr checks <pr_number> --json` synchronously. All-green → finish succeeded; any red → next engineer iteration (the dev brief instructs the worker to fetch the failing-job log itself); pending → dispatch a `ci-waiter` (reviewer in MODE: ci, brief=`template-review-ci`) that blocks on `gh pr checks --watch`.
- Add **ci-waiter terminal** cases: "one parent, `official/reviewer`, succeeded" → finish or next dev iter per verdict; "one parent, `official/reviewer`, failed/cancelled" → finish failed. Single-parent shape disambiguates ci-waiter from the normal review + designer pair.
- Add `template-review-ci` brief template (PR number + repo + verdict mapping for MODE: ci) and label `template-review` with an explicit `MODE: code` header so the reviewer agent knows which mode to enter.
- **Breaking (artifact paths)**: all verdict and narrative paths in brief templates move from `<task-workdir>/verdict.json` and `<task-workdir>/review.md` to `<workdir>/artifact/verdict.json` and `<workdir>/artifact/review.md` so the substrate auto-harvests them into `success.artifacts` and the dashboard Artifacts tab surfaces them.
- **Drop the `<task-workdir>/branch.txt` convention**: `${BRANCH_NAME}` now derives from `gh pr view <pr_number> --json headRefName` against the prior dev task's PR URL (read from `success.output` / activity log) — no new engineer contract required, one fewer artifact dev must produce.
- Add `${PR_NUMBER}` placeholder (used by `template-dev-iter-2-plus` and `template-review-ci`) and document its derivation from the prior dev task's `gh pr create` output.
- Stop condition: tighten to require `gh pr checks` green in addition to APPROVE verdicts; replace the deferred-iteration-cap paragraph with explicit coord-judgment language (`finishWorkflow(failed, "convergence stalled — N iterations and still seeing the same finding category")`).
- Failure-mode coverage matrix: add rows for the CI sub-cases and the ci-waiter terminal shapes.
- Add **Agent compatibility statement** (per `official/workflow-coordination` §E item 6) listing the minimum `AGENTS.md` version validated for `official/engineer`, `official/reviewer`, `official/designer`, and `official/coordinator`.

## 0.1.1 (2026-06-11)

- Update references to the generic coord framework skill: `official/coordinator` → `official/workflow-coordination` (the skill was renamed to disambiguate from the agent of the same name). No behavior change.

## 0.1.0 (2026-06-11)

- Initial release.
