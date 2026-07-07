# Mission progress tracking

Each mission has its own progress trail. You roll up multiple tasks into a single coherent narrative.

## Per-mission state files

Each mission owns `.pilot/active-missions/<mission-id>/` (files enumerated in `references/state-management.md`). Semantics:

- `goal.md` is the mission's "north star", immutable after mission start. Changing it means a strategic pivot.
- `plan.md` decomposes the mission into steps with checkbox-style progress markers.
- `tasks.json` maps `{step_id: glyph_task_id}`.
- `progress.md` is the append-only narrative — every meaningful mission event lands here.
- `risks.md` tracks identified risks + mitigation status; update as risks emerge or resolve.

## `plan.md` format

```markdown
# Plan

## Step 1: <short name>
- [x] <sub-step> (task <tid>, completed <date>)
- [x] <sub-step> (task <tid>, completed <date>)

## Step 2: <short name>
- [x] <sub-step> (task <tid>, completed <date>)
- [ ] <sub-step> ← in flight, task <tid>
- [ ] <sub-step>

## Step 3: <short name>
- [ ] <sub-step>
- [ ] <sub-step>
```

The `← in flight` marker tells you on resume / next tick where work is currently running. Check off boxes as task outcomes arrive.

## `progress.md` format

Append-only chronicle. Each entry is timestamped + one paragraph.

```markdown
# Progress

## 2026-05-13T10:00:00Z
Founded mission. Decomposed into 5 steps. Hired writer agent.

## 2026-05-13T10:30:00Z
Step 1 (research) dispatched to local/research-agent (task 20260513-abc123).

## 2026-05-13T11:45:00Z
Task 20260513-abc123 completed. Output: 12 sources synthesized into 800-word brief. Quality: good. Advancing to step 2.

## 2026-05-13T11:50:00Z
Step 2 (drafting) dispatched to local/writer (task 20260513-def456).

## 2026-05-13T13:00:00Z
Task 20260513-def456 completed. Draft is 2200 words; goal called for ~1500. Will dispatch step 2.5 (compression pass) before moving to step 3.
```

When in doubt about whether to log something, log it. Future-you reading this on resume needs the context.

## Reading mission state on resume

Reading + reconciling mission state during session restart is documented in `references/edge-cases/session-restart-recovery.md`. This file owns the ongoing tracking format (above); the recovery file owns the resume flow.

## Mission-level health metrics (optional but useful)

Periodically (e.g. every 24h or every 10 ticks), compute:

- **Velocity**: tasks completed in the last 24h
- **Failure rate**: failures / total in the last 7 days
- **Stuck rate**: stuck-task interventions / total dispatches
- **Time-to-step-completion**: avg wall time from dispatch to completion per step

Append to `progress.md`. If any metric is concerning (e.g. failure rate climbing, velocity dropping), surface in next user-facing report and consider a strategy review.

## Abandon a mission

When a mission is being ended without hitting its success criteria (emergency triage, strategic pivot, or a capacity drop), this is the canonical procedure. Both `edge-cases/emergency-mode.md` and `edge-cases/strategic-pivot.md` reach this from their own decision paths.

```sh
# 1. Write outcome.md in the still-active-missions directory.
cat > .pilot/active-missions/<id>/outcome.md <<EOF
# Outcome

Status: abandoned
Date: $(date -u +%Y-%m-%d)
Reason: <one paragraph — trigger, root cause, why abandonment beat other options>
Pre-abandon state: preserved in place (this directory becomes the archive).
EOF

# 2. Move active-missions/<id>/ → archived-missions/<id>/.
mv .pilot/active-missions/<id> .pilot/archived-missions/

# 3. Append to decisions.log.
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | ABANDON | mission <id> | <one-line reason>" >> .pilot/decisions.log
```

For any in-flight tasks the mission still owned, decide per task whether to cancel (`glyph task rm`) or let complete (output may seed a follow-up). Record the choice in the moved `progress.md` before the `mv`.

## When to surface mission status to the user

In the session terminal:

- Step completed (one-line: "Mission X step Y complete.")
- Step blocked / failed (full triage)
- Mission complete (deliverable + post-mortem summary)
- Mission abandoned (reason + post-mortem pointer)

In `.pilot/reports/`:

- Weekly all-hands (rituals/weekly-allhands.md)
- On-demand when the user asks "how are we doing"

Aggregate task completions into a single mission-level line when a mission has many; don't surface each one to the terminal.
