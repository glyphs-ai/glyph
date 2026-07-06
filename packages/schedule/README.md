# @glyphs-ai/schedule

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

Cron-triggered substrate. Owns one table — `schedules` — a set of
use-cases (create / patch / delete / run / get / list / preview), the
stateful `ScheduleEngine` (`recover()` + `shutdown()` + timer arming),
and an open registry of per-kind handlers.

The pkg has **no built-in knowledge of any concrete kind**. Callers
register handlers on the engine at compose time, then `recover()`:

```ts
const scheduleModule = await composeScheduleModule({ dbFile });
scheduleModule.engine.registerKind("task", makeTaskKindHandler({ tasks, catalog }));
scheduleModule.engine.registerKind("workflow", makeWorkflowKindHandler({ workflows }));
await scheduleModule.engine.recover(); // freezes the registry; MUST come AFTER every registerKind
```

Adding another kind requires **zero edits** to this package. Only:

1. Define a `ScheduleKindHandler` where the kind's dependencies live
   (the host's wiring layer).
2. Call `engine.registerKind("<kind>", handler)` before
   `engine.recover()`.
3. (For server-exposed kinds) add per-kind routes + wire DTOs in the
   host, and — optionally — a partial JSON-index migration in this
   package.

## Substrate ⇄ handler split

The schedule pkg owns the substrate concerns:

- the `schedules` table + Drizzle migrations
- envelope storage (`target_kind` column + `target_json` blob)
- the croner-driven timer chain (`armNext` / `fire`)
- `recover()` (catchup-once at boot) and `shutdown()`
- kind-agnostic invariants on `name`, `trigger`, and the JSON-path
  grammar for `dataEquals` list filters

The registered `ScheduleKindHandler` owns the per-kind concerns:

- payload shape validation (`validate(data, { changedKeys? })`)
- JSON merge-patch — a deep merge in which a `null` field deletes that
  key (`mergePatch(existing, patch) → { data, changedKeys }`)
- fire dispatch (`dispatch({ scheduleId, firedAt, data })`)
- in-flight check + cascade delete (`hasInFlightForSchedule` /
  `deleteForSchedule`)

The handler interface is intentionally non-generic — `data: unknown`
all the way through. Per-kind type safety lives at the EDGES (route
handlers narrow before calling `createSchedule.execute`; handlers cast
after their own `validate` produces a value). A
`ScheduleKindHandler<TData>` generic would force every consumer to track
the kind→T mapping at compile time, which would turn the substrate into
a closed registry.

## Layout

```
packages/schedule/
├── drizzle/                  SQL migrations (source of truth; inlined into the bundle)
│   ├── 0000_*.sql            drizzle-kit generated baseline
│   └── 0001_*.sql            hand-written functional partial JSON-extract index
├── drizzle.config.ts
└── src/
    ├── index.ts              public barrel
    ├── schedule-module.ts    composeScheduleModule + the ScheduleModule container
    ├── application/          use-cases, the engine, and ports
    │   ├── {create,patch,delete,run,get,list,preview}-schedule.ts
    │   ├── use-case.ts         shared use-case contract
    │   ├── schedule-public.ts  application-layer barrel
    │   ├── engine/schedule-engine.ts   stateful scheduler (timers + registry freeze)
    │   └── ports/            schedule-kind-handler.ts, schedule-kind-registry.ts
    ├── domain/schedule/      entity, value objects, cron service, error atoms
    │   ├── schedule-entity.ts, schedule-target.ts, schedule-trigger.ts
    │   ├── schedule-id.ts, cron.ts, schedule-errors.ts
    │   └── schedule-repository.ts       write-side port (get / save / delete)
    └── infrastructure/
        ├── cron/describe.ts             cronstrue human-readable description
        └── drizzle/                     schema, migrations, mapper, queries, repository, db
```

## Invariants

1. **Cron dialect** — 5-field POSIX only. 6-field expressions are
   rejected with the `InvalidCronExpr` error atom, whose `reason` reads
   `"6-field cron not supported in v1; use 5-field POSIX form"`.
2. **Concurrency = 1** — if `handler.hasInFlightForSchedule(id)`
   returns `true` at fire time, the tick is skipped (warn-logged) and
   re-armed without writing `last_fired_at`.
3. **Catchup-once** — `recover()` collapses every missed fire into a
   single catchup dispatch with `firedAt` set to the planned (past)
   time, not `now`.
4. **Cascade delete with guards** — `deleteSchedule.execute` errs with
   `ScheduleEnabled` if `enabled === true`, and `ScheduleHasInFlight`
   if the handler reports in-flight work. Otherwise it cancels the
   timer, calls `handler.deleteForSchedule` (which MUST filter to
   terminal status only), re-checks in-flight, then drops the schedule
   row. The response is `{ deletedDispatchCount }` so callers can
   surface the cascade count.
5. **Manual `runSchedule` bypasses `enabled`** — manual fires are
   user-initiated and ignore the concurrency check. Records
   `last_fired_at`, recomputes `next_fire_at`, does NOT re-arm, and
   returns `{ dispatchId }`.
6. **Patch never affects in-flight dispatches** — only the trigger /
   arm state is recomputed when `trigger` or `enabled` changed;
   already-dispatched units continue under their handler's
   lifecycle.
7. **Registry freezes on first `recover()`** — `registerKind` after
   freeze returns the `ScheduleKindRegistryFrozen` atom. `recover()`
   itself preflights every row (enabled AND disabled) and returns
   `ScheduleKindNotRegistered` for any row whose `target_kind` has no
   handler. Both are `Result`s; the composition root converts a
   failure into a throw to abort the workspace load.
8. **Persisted data is trusted on read** — the read side
   (`ScheduleQueries`, behind the `getSchedule` / `listSchedules`
   use-cases) produces envelopes with `data: unknown` from
   `JSON.parse(target_json)`. The pkg does NOT invoke
   `handler.validate` on every read (it would require a catalog
   round-trip per row in the list path, and the row was already
   validated at create / patch time). Handlers that want
   belt-and-braces re-checks on dispatch can do so inside
   `handler.dispatch`.

## Data model

`schedules` stores the envelope across two columns:

- `target_kind TEXT NOT NULL` — the registered kind name.
- `target_json TEXT NOT NULL` — `JSON.stringify(envelope.data)`. The
  `kind` is **not** redundantly nested inside `target_json` (that
  would let the column disagree with the JSON, and would force every
  read to pay for a redundant parse).

**Indexes.** `schedules_target_agent_idx` is a **functional partial
index** on `json_extract(target_json, '$.agent')` filtered
`WHERE target_kind = 'task'`. It's task-kind-specific (the task
handler stores `agent` in `data.agent`) and stays in the schema for
the list-by-agent query. Other kinds add their own partial-index
migrations when they need them. The `listSchedules` use-case's generic
`{ kind, dataEquals }` filter engages this index automatically when
called with `{ kind: "task", dataEquals: { path: "$.agent", value }}`;
without BOTH predicates SQLite's planner can't prove the partial
predicate and falls back to a scan.

## Composition

```ts
const scheduleModule = await composeScheduleModule({
  dbFile: path.join(workspaceDir, "workspace.db"),
  logger,
});
scheduleModule.engine.registerKind("task", makeTaskKindHandler({ tasks, catalog }));
await scheduleModule.engine.recover();
// ... application runs ...
await scheduleModule.close(); // shuts the engine down, then closes the SQLite handle
```

Order matters: every kind must be registered BEFORE `recover()` runs,
otherwise the preflight errs with `ScheduleKindNotRegistered`. Tests can
call `recover()` with no rows in the DB — preflight returns immediately
and freezes the registry.
