# ADR: Decouple workflow / task from schedule via `origin` + scoped metadata filter

**Status:** Accepted
**Date:** 2026-06-23
**Owner:** Lang
**Related PR:** #60 (current schedules overhaul — introduces the coupling we want to remove)

---

## Problem

`packages/workflow` and `packages/task` currently bake **schedule-specific semantics** into their data layer:

- `workflow-repository.aggregateRunningFireStatsByScheduleId()` knows `origin='schedule'` AND `json_extract(metadata, '$.scheduleId')`
- Task lists are queried with `?scheduleId=` filters that assume the same convention
- Result: both packages "know" that schedule is a thing, what key its id lives under, and how to query it

Cost of the coupling:
1. Adding new trigger sources (webhook, manual replay, campaign) means new `countXByYId` methods in workflow/task
2. Schedule's metadata shape becomes a contract two other packages depend on; renaming `scheduleId` is a cross-package change
3. Unit tests in workflow/task surface schedule concepts unnecessarily

## Insight

**`origin` is the namespace tag for metadata schema ownership.**

- `origin='schedule'` → metadata schema owned by `packages/schedule`
- `origin='webhook'`  → metadata schema owned by future `packages/webhook`
- `origin='manual'`   → etc.

Workflow / task are **schema-opaque containers**. They expose a narrow generic primitive; each integration package wraps it with its own typed API.

## Decision

### 1. Workflow / task expose a single narrow aggregation primitive

```ts
// packages/workflow/src/workflow-service.ts (mirror on task-service)
aggregateByOriginMetadataKey(opts: {
  origin: string;
  metadataKey: string;          // e.g. 'scheduleId'
  metadataValues: readonly string[];
  statusIn?: readonly string[];
}): Promise<ReadonlyMap<string /* metadataValue */, {
  totalCount: number;
  runningCount: number;
  awaitingCount: number;        // workflows with ≥1 running human node
}>>
```

Constraints (deliberate):
- One origin per call (no cross-origin queries → no need for typed `origin_id` column)
- One metadata key per call (no arbitrary WHERE → no query-builder bloat)
- `statusIn` is the only freeform filter; domain semantics (`awaitingCount` = "workflow has ≥1 running human node") stay in workflow package
- Returns `Map<metadataValue, agg>` — `groupBy` is implicit

### 2. Integration packages own their typed wrapper

```ts
// packages/schedule/src/schedule-service.ts
private async loadFireStatsForWorkflowSchedules(scheduleIds: readonly string[]) {
  return this.workflowQuery.aggregateByOriginMetadataKey({
    origin: 'schedule',
    metadataKey: 'scheduleId',
    metadataValues: scheduleIds,
    statusIn: ['running'],
  });
}
```

The `'schedule'` / `'scheduleId'` strings are written, read, and indexed entirely inside `packages/schedule`. Workflow has zero schedule knowledge.

### 3. Index ownership: **owner package holds the DDL, integration owns the *need***

Partial expression indexes on `workflows` and `tasks` live in the **owner package's** drizzle migrations (matches existing `tasks_schedule_id_idx` in `packages/task/drizzle/0001_tasks_schedule_id_idx.sql`):

```sql
-- packages/workflow/drizzle/NNNN_workflows_schedule_metadata_idx.sql
CREATE INDEX IF NOT EXISTS `workflows_schedule_id_idx`
  ON `workflows` (json_extract(`metadata`, '$.scheduleId'))
  WHERE `origin` = 'schedule';
```

The SQL file is the only place workflow/task packages reference an `origin` name like `'schedule'`. **Runtime code remains schema-opaque.**

**Rejected alternative (C: runtime `registerOriginMetadataIndex(origin, key)` API)**:
- Loses drizzle migration tooling (no journal, no rollback story)
- Index-name generation rule introduces silent collision risk + SQL-injection surface to validate
- Diverges from existing `tasks_schedule_id_idx` ownership pattern
- Test helpers must remember to register indexes alongside applying migrations
- Only pays off if origins explode to 10+ or come from third-party plugins (neither is current reality)

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Typed `triggered_by_kind` + `triggered_by_id` columns on workflow/task | Over-defensive for current uncertainty; introduces certain cost (migration, schema churn) to hedge an uncertain future. Can be added later if metadata-filter approach hits limits. |
| Open-ended generic query builder (`{ where: {...}, groupBy, aggregations }`) | Unbounded API surface; will reinvent half of MongoDB aggregate over time; type safety = 0; hard to audit / index. |
| Schedule maintains its own `schedule_fire_stats` projection table via event bus | Yak-shave for current scale; needs event bus + consistency window + replay; appropriate if/when fireStats reads dominate. |
| Document the coupling and move on | Doesn't address root cause; next trigger source forces the change anyway. |

## When to revisit (signals to upgrade to typed columns)

1. A single origin needs aggregation across **multiple** metadata keys (schedule by scheduleId AND fireId AND retryGroup) → index count blows up
2. Need to query **across origins** ("all workflows triggered by something with retry policy X") → needs typed columns
3. SQLite tables hit 10M+ rows where expression-index plans degrade

Until any of these fire, the `origin + scoped metadata filter` approach is the optimal point on the cost/value curve.

## Implementation plan — single PR, multiple phased commits

User preference: **one PR covers workflow + task + schedule + cleanup**. Commits are split for review clarity.

### Phase 1 — Workflow primitive (additive)
1. Add `aggregateByOriginMetadataKey({ origin, metadataKey, metadataValues, statusIn? })` to `workflow-service` + `workflow-repository`
2. Add a `workflows_<origin>_<metadataKey>_idx` partial expression index migration under `packages/workflow/drizzle/` for `origin='schedule', metadataKey='scheduleId'`
3. Unit tests using a **synthetic origin** (e.g. `'fake-origin-x'`) + arbitrary `metadataKey` — proves workflow is schema-opaque (test file contains zero `schedule` strings)
4. Old `aggregateRunningFireStatsByScheduleId` stays for now

### Phase 2 — Task primitive (additive, mirrors phase 1)
5. Add the same primitive to `task-service` + `task-repository`
6. Note: `tasks_schedule_id_idx` partial index already exists in `packages/task/drizzle/0001_tasks_schedule_id_idx.sql` — verify it satisfies the new primitive's query plan; no new migration needed
7. Unit tests with synthetic origin

### Phase 3 — Schedule typed wrapper (integration)
8. Schedule package wraps both primitives via thin typed methods (`loadFireStatsForWorkflowSchedules`, `loadFireStatsForTaskSchedules`)
9. Switch `schedule-service` call sites from old `aggregateRunningFireStatsByScheduleId` to the wrapper
10. End-to-end test: real schedule fires real workflow → wrapper returns correct fireStats

### Phase 4 — Cleanup
11. Delete `aggregateRunningFireStatsByScheduleId` from workflow public API
12. Grep `packages/workflow/src` + `packages/task/src` for any remaining `schedule` / `scheduleId` references in runtime code (SQL files in `drizzle/` are OK)
13. Update CHANGELOG

### `statusIn` parameter — yes, include
The legacy method hardcoded `status='running'`. New API exposes `statusIn?: readonly string[]` so integrations can ask for any subset (e.g. `['running', 'paused']`). Default = no status filter (returns all rows for the matching origin + metadataKey + values).

### Quality gate (must pass before merge)
`pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm lint` — all green.

### Promote ADR
Move `research/glyph-decoupling-adr.md` to `docs/adr/NNNN-origin-metadata-decoupling.md` with status `Accepted` as part of this PR.

## Notes

- Keep changes additive in the first commit (add new API alongside old); deprecate + delete old API in a follow-up commit so review can focus on the new shape first
- Use this as a chance to also re-examine `tasks` table for the same coupling (`?scheduleId=` filter on list endpoint)
- The "Workflow/task is schema-opaque, origin is the namespace" insight is the load-bearing idea; preserve it in commit messages / ADR text
