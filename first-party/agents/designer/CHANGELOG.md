# Changelog

## 0.2.1 (2026-07-07)

- Extract the `MODE: review` seven-step playbook into `references/mode-review-playbook.md`; **AGENTS.md** now carries a ~5-line mode summary + a pointer to the playbook.
- Prune **Common pitfalls** from 11 items to 3 (kept only additive nuance not already covered by 🚫 **Never**: read the surrounding component in full, discard stale `.playwright/storage-state.json` between runs, and populate the spec's *Inputs consulted* / *Acceptance criteria* sections).
- Consolidate the "default review verdict to REQUEST_CHANGES" heuristic to a single location (✅ **Always**); drop the pitfall and the playbook's "default away from approval" phrasing (the verdict rules already encode the bar).
- Replace the inline `gh api .../pulls/<n>/reviews` invocation + review-body JSON in the playbook's Step 6 with a pointer to the `git-pr` skill's **GitHub PR review submission** section (single source of truth shared with `official/reviewer`).

## 0.2.0 (2026-06-12)

- **Breaking (output location)**: all designer outputs now live under `<workdir>/artifact/` so the substrate auto-harvests them into `success.artifacts` and the dashboard Artifacts tab shows them. Specifically: spec markdown moves from workDir root to `<workdir>/artifact/spec-<slug>.md`; review-mode narrative moves from workDir root to `<workdir>/artifact/review.md` (filename unified with `official/reviewer`); machine-readable verdict written to `<workdir>/artifact/verdict.json` per `workflow-coordination/SKILL.md` §C; Playwright evidence moves from `workDir/playwright-evidence/` to `<workdir>/artifact/playwright-evidence/`.
- Update reporting section to point at the new `artifact/` paths.

## 0.1.0 (2026-06-11)

- Initial release.
