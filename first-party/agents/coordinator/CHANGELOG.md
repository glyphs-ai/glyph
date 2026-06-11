# Changelog

## 0.1.2 (2026-06-11)

- Require a self-contained HTML summary report at `$GLYPH_WORKFLOW_DIR/artifact/summary.html` before `workflow finish --outcome succeeded`. The dashboard's workflow Artifacts tab auto-surfaces this as the default-selected entry via the substrate's existing auto-harvest path. The report captures the workflow brief, final outcome, dispatched task tree (agent / phase / status / taskId / duration per node), PR / deliverable URL, reviewer verdicts verbatim, per-wake-up decisions, and links to per-node artifacts. "Self-contained" means no external CSS / fonts / images / scripts (inline only) so the iframe-based viewer renders cleanly. Failed / cancelled summaries are encouraged but optional.

## 0.1.1 (2026-06-11)

- Update references to the generic coord framework skill: `official/coordinator` skill → `official/workflow-coordination` (the skill was renamed to disambiguate from this agent of the same name; `dependencies.skills` URL updated accordingly). No behavior change.

## 0.1.0 (2026-06-11)

- Initial release.
