# Changelog

## 0.1.1 (2026-06-11)

- Require a self-contained HTML report at `<workdir>/artifact/engineer-report.html` on task completion. The substrate auto-harvests `<workdir>/artifact/` siblings into the workflow detail page's Artifacts tab, so this becomes the operator's single point of entry into "what did this engineer node actually do" — PR / branch info, files changed (grouped by package), tests added, build / typecheck / test / lint verification, and any non-obvious decisions. "Self-contained" means no external CSS / fonts / images / scripts (inline only) so the iframe-based viewer renders cleanly.

## 0.1.0 (2026-06-11)

- Initial release.
