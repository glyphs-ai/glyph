# Changelog

## 0.2.3 (2026-07-07)

- Consolidate five duplicated topics into single-source homes so future edits touch one file, not many.
  - **State layout** — `.pilot/` top-level + per-mission directory listing lives only in `references/state-management.md`. `AGENTS.md`, `references/bootstrap.md`, `references/monitoring/mission-progress-tracking.md`, and `references/edge-cases/session-restart-recovery.md` now point at it instead of duplicating.
  - **Abandon-a-mission procedure** — the outcome.md + move-to-archived-missions/ + decisions.log recipe lives only in `references/monitoring/mission-progress-tracking.md` under a new `Abandon a mission` section. `references/edge-cases/emergency-mode.md` and `references/edge-cases/strategic-pivot.md` reach it by pointer.
  - **Agency-role-library workflow** — the `cat <SKILL_DIR>/references/index.md` + `curl` + specialize flow lives only in `references/hiring/writing-good-agent-prompts.md`. `references/hiring/decision-tree.md` reaches it by pointer.
  - **`official/cli` frontmatter rule for local agents** — the "never declare `official/cli` in a local agent's `dependencies.skills`" rule lives only in `references/hiring/template-base.md`. `references/communication/no-direct-subagent-talk.md` no longer duplicates it.
  - **NEVER / ALWAYS constraint-strength heuristic** — promoted to a first-class subsection in `references/hiring/writing-good-agent-prompts.md` (anchor `#never-always`). `references/communication/to-subagent.md` reaches it by pointer.
- Prune rationale no-ops and rewrite negation-form guidance in positive form:
  - `AGENTS.md`: dropped the highlighted subset of `.pilot/` (whole layout now in state-management.md).
  - `references/bootstrap.md`: dropped inline strategy.md template and org-chart.md template bodies; dropped `Capture it` soft no-op.
  - `references/communication/no-direct-subagent-talk.md`: dropped the `Why` 4-bullet rationale and the `What goes wrong if you violate this` section.
  - `references/communication/to-subagent.md`: dropped `No filler` bullet.
  - `references/communication/to-user.md`: trimmed redundant `Don't keep poking` clause.
  - `references/edge-cases/emergency-mode.md`: rewrote three `What NOT to do` bullets in positive form with pointers to the correct tracks (hires-evaluation, strategic-pivot).
  - `references/edge-cases/multi-mission.md`: trimmed `tokens are infinite for you` aside from Hard cap.
  - `references/edge-cases/session-restart-recovery.md`: dropped `Pre-emptive resilience` section (now under `Hygiene / Persist immediately` in state-management.md).
  - `references/hiring/writing-good-agent-prompts.md`: rewrote `Be helpful and accurate is filler` anti-pattern in positive form.
  - `references/monitoring/mission-progress-tracking.md`: dropped `Reading mission state on resume` bash block (belongs in session-restart-recovery.md); tightened `Don't be noisy` pair to one positive sentence.

## 0.2.2 (2026-06-12)

- Realign the **Commands quick reference** table to the new CLI id-flag convention (`packages/cli/README.md` → "Naming conventions"): `glyph task show <tid>` / `task activity <tid>` → `<task-id>` (positional); `glyph workflow cancel <wfid>` → `glyph workflow cancel <workflow-id>` (positional). Documentation-only change.

## 0.2.1 (2026-06-12)

- Drop the inline **Choosing between `task` and `workflow`** subsection under **Dispatching tasks**; replace with a one-line pointer to the `official/dispatch-with-details` skill body. The decision rule + brief authoring + watchdog notes are dispatch-time concerns shared by every dispatcher (not pilot-specific), so they now live next to the primitive that handles them. Single source of truth.

## 0.2.0 (2026-06-12)

- Add **Match the user's energy + show numbers** bullet to **Mindset summary**: brief when they're brief, deep when they ask; concrete numbers (file counts, byte sizes, test counts, commit SHAs, durations) beat vague prose.
- Add **Workspace state hygiene** rule to **Hard rules**: never commit `.pilot/` state into the application repo; `.pilot/` is the orchestrator's per-workspace brain.
- Add **Choosing between `task` and `workflow`** section under **Dispatching tasks**: decision rule (PR → workflow; one-shot exploration → task; unsure → start with task and escalate when you find yourself hand-rolling iteration), shared brief authoring + watchdog skills, and the concurrency note that workflows are workflow-scoped, not workspace-scoped.

## 0.1.0 (2026-06-11)

- Initial release.
