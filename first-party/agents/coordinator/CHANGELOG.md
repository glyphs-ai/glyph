# Changelog

## 0.1.2 (2026-06-12)

- Add **Pre-flight validate** rule to the **✅ Always** list: before dispatching, validate every brief template against the dispatched agent's current `AGENTS.md` per `official/workflow-coordination` §D; log drift to `coord-decisions/` and escalate per the severity matrix; never patch templates inline.
- Add sub-step **2a** under **Setup**: fetch each matched-case dispatched agent's `AGENTS.md` via `glyph catalog agent show <fqn> --json`, run the §D validation, and record the outcome in this wake-up's `coord-decisions/` audit entry; finish failed on blocker-severity drift.
- Update **Verdict parsing** + **Read worker artifacts** path to `<task-workdir>/artifact/verdict.json` (matches the new artifact-harvest convention shared with reviewer/designer).

## 0.1.1 (2026-06-11)

- Update references to the generic coord framework skill: `official/coordinator` skill → `official/workflow-coordination` (the skill was renamed to disambiguate from this agent of the same name; `dependencies.skills` URL updated accordingly). No behavior change.

## 0.1.0 (2026-06-11)

- Initial release.
