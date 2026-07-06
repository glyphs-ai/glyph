/**
 * Public API of `@glyphs-ai/schedule`.
 *
 * Cron-triggered substrate with an open handler registry — the pkg knows about
 * no concrete kinds. Construction goes through `composeScheduleModule({ dbFile
 * | db })`, which returns a {@link ScheduleModule}: a DI container of use-case
 * instances plus the stateful {@link ScheduleEngine}. There is no service
 * facade; consumers call `module.<useCase>.execute(request)`.
 *
 * Callers register per-kind handlers on the engine at compose time, then
 * `recover()` (which freezes the registry):
 *
 * ```ts
 * const scheduleModule = await composeScheduleModule({ dbFile });
 * scheduleModule.engine.registerKind("task", makeTaskKindHandler({ tasks, catalog }));
 * await scheduleModule.engine.recover();
 * ```
 */

// ─── Application: use-cases, engine, ports ──────────────────────────
export * from "./application/schedule-public.js";
export {
  type InvalidCronExpr,
  type InvalidTimezone,
  nextRuns,
  validateCron,
  validateTimezone,
} from "./domain/schedule/cron.js";
// ─── Domain: entity, value objects, cron service, error atoms ───────
export { ScheduleEntity } from "./domain/schedule/schedule-entity.js";
export type {
  InvalidScheduleName,
  ScheduleCorruption,
  ScheduleEnabled,
  ScheduleHasInFlight,
  ScheduleKindMismatch,
  TargetKindImmutable,
} from "./domain/schedule/schedule-errors.js";
export {
  generateScheduleId,
  type InvalidScheduleId,
  parseScheduleId,
  type ScheduleId,
  ScheduleIdSchema,
} from "./domain/schedule/schedule-id.js";
export type {
  DatabaseUnavailable,
  ScheduleNotFound,
  ScheduleRepository,
} from "./domain/schedule/schedule-repository.js";
export {
  type ScheduleTargetEnvelope,
  ScheduleTargetEnvelopeSchema,
} from "./domain/schedule/schedule-target.js";
export {
  type ScheduleTrigger,
  ScheduleTriggerSchema,
  validateTrigger,
} from "./domain/schedule/schedule-trigger.js";
export { describeCron } from "./infrastructure/cron/describe.js";
// ─── Infrastructure: db, migrations, schema, queries, describe ──────
export { type Db, openDb } from "./infrastructure/drizzle/schedule-db.js";
export { ScheduleMapper } from "./infrastructure/drizzle/schedule-mapper.js";
export {
  applyScheduleMigrations,
  MIGRATIONS,
} from "./infrastructure/drizzle/schedule-migrations.js";
export {
  DrizzleScheduleQueries,
  type ScheduleQueries,
} from "./infrastructure/drizzle/schedule-queries.js";
export { DrizzleScheduleRepository } from "./infrastructure/drizzle/schedule-repository.js";
export {
  type NewScheduleRow,
  type ScheduleRow,
  schedules,
} from "./infrastructure/drizzle/schedule-schema.js";
// ─── Composition ────────────────────────────────────────────────────
export * from "./schedule-module.js";
