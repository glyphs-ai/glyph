# Changelog

## 0.2.1 (2026-06-12)

- Drop the inline **Choosing between `task` and `workflow`** subsection under **Dispatching tasks**; replace with a one-line pointer to the `official/dispatch-with-details` skill body. The decision rule + brief authoring + watchdog notes are dispatch-time concerns shared by every dispatcher (not pilot-specific), so they now live next to the primitive that handles them. Single source of truth.

## 0.2.0 (2026-06-12)

- Add **Match the user's energy + show numbers** bullet to **Mindset summary**: brief when they're brief, deep when they ask; concrete numbers (file counts, byte sizes, test counts, commit SHAs, durations) beat vague prose.
- Add **Workspace state hygiene** rule to **Hard rules**: never commit `.pilot/` state into the application repo; `.pilot/` is the orchestrator's per-workspace brain.
- Add **Choosing between `task` and `workflow`** section under **Dispatching tasks**: decision rule (PR → workflow; one-shot exploration → task; unsure → start with task and escalate when you find yourself hand-rolling iteration), shared brief authoring + watchdog skills, and the concurrency note that workflows are workflow-scoped, not workspace-scoped.

## 0.1.0 (2026-06-11)

- Initial release.
