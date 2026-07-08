# Changelog

## 0.3.0 (2026-07-07)

- Add a **Correcting a not_started node's spec** section: when to use `workflow update-spec` (typo/brief/agent-swap, same kind + edges) vs. `prune`/`remove-node` + re-add (kind change, restructure); the patch is a partial overlay (omitted fields keep their prior value); never patch a coordinator node (`CoordSpecNotEditable`). Add a Commands-table row and list `workflow update-spec` under **Write Access**.

## 0.2.2 (2026-07-07)

- Replace the inline copy of `official/workflow-coordination` §A steps 1–9 in the Wake-up loop with a single pointer ("Run §A of the loaded skill"); fold the standalone **Discipline** bullets into **✅ Always** (adds "re-read the DAG on every wake-up" and "use §B DAG introspection snippets") and delete the standalone list. Drop the §A/§B/§C/§D/§E TOC narration from Setup step 1.
- Move the "never touch the substrate database directly" rule into **Write Access** as its single source; delete duplicates from ✅/🚫 and replace the Commands-section footer with a pointer to Write Access. Extend the "🚫 poll or wait for parents" rule with its positive counterpart (the substrate re-wakes me when parents terminate; I read the DAG on each wake-up, never between).

## 0.2.1 (2026-06-15)

- **Boundary**: extend the "Insert a human approval node" rule to call out the new mandatory `promptStyle` field on the `add-subgraph` human-node spec. Coord must declare `"plain"` or `"markdown"` on every human-node insertion so the dashboard renders intentional formatting; cross-references `official/workflow-coordination` §F for the per-value guidance.

## 0.1.3 (2026-06-12)

- Realign the **Commands** table and **Wake-up loop** snippet to the new CLI id-flag convention (`packages/cli/README.md` → "Naming conventions"): `glyph workflow show --wfid $WF` → `glyph workflow show $WF` (positional `<workflow-id>`); `glyph task show --tid <id>` → `glyph task show <task-id>` (positional). Fix the **Expand the DAG** row's stale `--input <payload.json>` to the correct `--spec-file <payload.json>`. Update the **Verdict parsing** snippet to use the positional `<task-id>` form. No behavior change — the substrate-side mutation routes are unchanged.

## 0.1.2 (2026-06-12)

- Add **Pre-flight validate** rule to the **✅ Always** list: before dispatching, validate every brief template against the dispatched agent's current `AGENTS.md` per `official/workflow-coordination` §D; log drift to `coord-decisions/` and escalate per the severity matrix; never patch templates inline.
- Add sub-step **2a** under **Setup**: fetch each matched-case dispatched agent's `AGENTS.md` via `glyph catalog agent show <fqn> --json`, run the §D validation, and record the outcome in this wake-up's `coord-decisions/` audit entry; finish failed on blocker-severity drift.
- Update **Verdict parsing** + **Read worker artifacts** path to `<task-workdir>/artifact/verdict.json` (matches the new artifact-harvest convention shared with reviewer/designer).

## 0.1.1 (2026-06-11)

- Update references to the generic coord framework skill: `official/coordinator` skill → `official/workflow-coordination` (the skill was renamed to disambiguate from this agent of the same name; `dependencies.skills` URL updated accordingly). No behavior change.

## 0.1.0 (2026-06-11)

- Initial release.
