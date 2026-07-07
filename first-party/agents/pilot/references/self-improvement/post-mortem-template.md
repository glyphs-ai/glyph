# Post-mortem template

Write one of these in `.pilot/post-mortems/<mission-id>.md` whenever a mission fails or has a notable setback. Brief but structured.

## Template

```markdown
# Post-mortem: <mission-id>

## Outcome
<one sentence: failed / completed-with-degradation / succeeded-with-near-misses>

## What we tried to do
<one paragraph from goal.md, refreshed with the actual scope at the time>

## What happened
<chronological summary, 3-10 bullet points, drawn from progress.md>

## Why it went wrong (or nearly went wrong)
<2-5 root causes; for each, separate "what" from "why">

Root cause 1: <what>
  Why: <why this happened — go one level deeper than the surface symptom>

Root cause 2: <what>
  Why: <why>

...

## What we'd do differently
<bullets — concrete, actionable changes>

## Lessons (extracted to .pilot/lessons.md)
<one-line statements suitable for the lessons file; copy these verbatim into lessons.md too>

## Agents involved
- <fqn>: <how they performed; reference hires.md entry>
- ...

## Files / artifacts
- <pointer to relevant logs, outputs, decisions>
```

## When to write

- Mission failed (couldn't complete the goal)
- Mission completed but with notable setbacks (one or more steps required intervention)
- Single task failure that's representative of a broader pattern (don't write for every routine failure)

## When NOT to write

- Routine task failure that you handled with a one-time retry. The retry's outcome goes in `progress.md`; no post-mortem needed.
- Mission abandoned for external reasons (user cancelled, scope changed). Document in `outcome.md` instead.

## Quality bar

- **Multiple root causes.** A singular root cause is rare; a good post-mortem finds 2–5.
- **Each "why" goes one level deeper than the surface.** Symptom ≠ cause. If the answer restates the failure, dig again.
- **"What we'd do differently" is concrete enough to actually do.** "Be more careful next time" fails this bar; "add a timezone-scope check to data-collector probe tasks" passes.
- **Own the instructions, not the agent.** If the agent followed a bad brief, the brief is the root cause.
- **Own the onboarding, not the user.** If the goal was unclear, surface that as a lesson about onboarding rigor at mission start.
- **Diagnostic, not penitential.** No apologies; propose fixes the company can implement.
- **Lessons flow out to `lessons.md`.** Otherwise the post-mortem is solo-knowledge that dies with the file.

## After writing

1. Append a one-line summary to `decisions.log`:
   ```
   YYYY-MM-DDTHH:MM:SSZ | POSTMORTEM | <mission-id> | <one-line takeaway>
   ```
2. Extract lessons per `self-improvement/lessons-extraction.md` — that file owns the extraction craft and copies into `lessons.md`.
3. If the post-mortem implies a hires.md update (agent was at fault, role was misdesigned), make that update too.
4. If the post-mortem implies a strategy.md change, surface it to the user — you don't change strategy unilaterally.
