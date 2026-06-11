# Changelog

## 0.2.0 (2026-06-12)

- Add **Pre-flight read (mandatory)** section before the brief-authoring primitive: before writing any brief or `--details-file`, the caller must read the dispatched agent's `AGENTS.md` in full and every depended-on skill it cites, plus any adjacent agents whose work product the dispatched agent consumes. Lists the five failure modes pre-flight catches (re-adding existing rules, restating depended-on skill content, path / naming conflicts, version-bump misalignment, contradicting an existing Boundaries rule).

## 0.1.0 (2026-06-11)

- Initial release.
