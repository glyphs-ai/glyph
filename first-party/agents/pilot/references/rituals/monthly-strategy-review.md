# Monthly strategy review

A deliberate pause to ask: are we still aimed at the right thing?

## When

First tick of each month, OR after any major mission completion / abandonment. Don't skip.

## Process

1. **Re-read `.pilot/strategy.md`** start to finish, annotating any drift you notice.
2. **Re-read `.pilot/lessons.md`** for the past month.
3. **Skim `.pilot/decisions.log`** — what did we actually do?
4. **Compare** decisions and outcomes against strategy. Annotate every success criterion with `closer / same / farther`, backed by evidence from the log.
5. **Write the review** to `.pilot/reports/<YYYY-MM-DD>-strategy-review.md`.
6. **Surface to user** if any items in the review require user decisions.

## Review questions

```
1. Mission alignment
   - Are we still working on the mission stated in strategy.md?
   - If we've drifted (intentionally or not), is the drift good or bad?
   - Should strategy.md be updated to reflect the current direction?

2. Success criteria
   - Are we measurably closer to the success criteria than 30 days ago?
   - If yes: by how much, on which dimensions?
   - If no: what's blocking, and what's the recovery plan?

3. Org fit
   - Does the current org chart fit the current mission needs?
   - Any roles that haven't been used? Any work that no role can do?
   - (Trigger org-evolution.md if changes needed.)

4. Time horizon
   - Are we on pace for the stated horizon?
   - If we're behind: scope down, accept slip, or escalate?
   - If we're ahead: take on more, refine quality, or rest the system?

5. Lessons absorption
   - Have we changed behavior based on this month's lessons?
   - Concrete examples: "Lesson X led to change Y in approach Z."

6. Open risks
   - Top 3 risks to mission success, currently
   - Mitigation status for each
```

## Output

```markdown
# Strategy review — <YYYY-MM-DD>

## Aligned?
<yes / partially / no — with one paragraph rationale>

## Progress on success criteria
- Criterion 1: <how far along, evidence>
- Criterion 2: <how far along, evidence>
- ...

## Org fit
<assessment + recommended changes>

## Pace
<on track / ahead / behind — with what to do about it>

## Lessons in action
<bullets — lessons learned this month + behavior changes triggered>

## Top 3 risks
1. <risk> — mitigation: <plan>
2. ...
3. ...

## Recommendation
<one of: stay-the-course / minor-adjustment / major-pivot / pause-and-discuss>
<one paragraph elaboration>
```

## When to pivot

If 3 consecutive monthly reviews say "behind on success criteria", consider that the mission scope was wrong. Surface to the user with a proposed pivot. Don't pivot unilaterally — strategy changes always need user agreement.

## Quality bar

- **Rate progress honestly.** If we haven't moved on a criterion, say so. Performative optimism rots the company.
- **Answer the uncomfortable questions.** If org fit is bad, say it. If pace is behind, say it. The user reads these.
- **Every review produces a concrete change** — or an explicit "no changes needed because X". A review that doesn't move the needle is wasted compute.
- **Every success criterion carries a `closer / same / farther` verdict** with evidence from the log.
