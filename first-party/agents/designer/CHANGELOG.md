# Changelog

## 0.2.0 (2026-06-12)

- **Breaking (output location)**: all designer outputs now live under `<workdir>/artifact/` so the substrate auto-harvests them into `success.artifacts` and the dashboard Artifacts tab shows them. Specifically: spec markdown moves from workDir root to `<workdir>/artifact/spec-<slug>.md`; review-mode narrative moves from workDir root to `<workdir>/artifact/review.md` (filename unified with `official/reviewer`); machine-readable verdict written to `<workdir>/artifact/verdict.json` per `workflow-coordination/SKILL.md` §C; Playwright evidence moves from `workDir/playwright-evidence/` to `<workdir>/artifact/playwright-evidence/`.
- Update reporting section to point at the new `artifact/` paths.

## 0.1.0 (2026-06-11)

- Initial release.
