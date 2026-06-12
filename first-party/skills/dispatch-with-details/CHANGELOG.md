# Changelog

## 0.3.1 (2026-06-12)

- Sweep stale `glyph workflow show --wfid <id> --json` references in the body text to the new positional shape `glyph workflow show <id> --json` (three sites: **Boundary**, **Why this skill exists**, and the Anti-patterns / dispatch-watchdog paragraph). The CLI's primary resource id is now a positional argument on every `workflow` subcommand and the short-flag spelling no longer exists.

## 0.3.0 (2026-06-12)

- Extend the skill to cover `glyph workflow create` alongside `glyph task dispatch`. The 200-char `--brief` cap + `--details-file` body convention is identical across the two verbs; the primitive now takes a `Kind` (PowerShell) / `--kind` (Bash) argument that picks the underlying verb. Defaults to `task` so pre-existing callers keep working unchanged.
- Add **Choosing between task and workflow** section between **Why this skill exists** and **Pre-flight read (mandatory)**. Relocated from the pilot agent's `AGENTS.md` so the rule lives next to the primitive it shapes — task-vs-workflow is a dispatch-time decision shared by every dispatcher, not pilot-specific.
- Update **Domain**, **Boundary**, **Why this skill exists**, **Caller contract**, and **Anti-patterns** so each section names both verbs (the previous wording was task-only).
- Update example invocations under both primitive variants to show `task` and `workflow` calls side by side.

## 0.2.0 (2026-06-12)

- Add **Pre-flight read (mandatory)** section before the brief-authoring primitive: before writing any brief or `--details-file`, the caller must read the dispatched agent's `AGENTS.md` in full and every depended-on skill it cites, plus any adjacent agents whose work product the dispatched agent consumes. Lists the five failure modes pre-flight catches (re-adding existing rules, restating depended-on skill content, path / naming conflicts, version-bump misalignment, contradicting an existing Boundaries rule).

## 0.1.0 (2026-06-11)

- Initial release.
