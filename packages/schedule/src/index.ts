/**
 * Public API of `@glyphs-ai/schedule`.
 *
 * Cron-triggered substrate with an open handler registry — the pkg
 * knows about no concrete kinds. Callers register per-kind handlers
 * at compose time:
 *
 * ```ts
 * const scheduleModule = await composeScheduleModule({ dbFile });
 * scheduleModule.service.registerKind("task", makeTaskKindHandler({ tasks, catalog }));
 * await scheduleModule.service.recover();
 * ```
 *
 * See `packages/api/src/wiring/schedule-task-handler.ts` for the
 * production task-kind handler. Tests use `openTestScheduleDb()`
 * from `./testing` and the `makeStubHandler()` helper from
 * `./test/_helpers.ts`.
 */

export { composeScheduleModule } from "./compose.js";
export { describeCron } from "./cron.js";
export {
  InvalidCronExprError,
  InvalidJsonPathError,
  InvalidScheduleIdError,
  InvalidTimezoneError,
  ScheduleEnabledError,
  ScheduleError,
  ScheduleHasInFlightError,
  ScheduleKindAlreadyRegisteredError,
  ScheduleKindMismatchError,
  ScheduleKindNotRegisteredError,
  ScheduleKindRegistryFrozenError,
  ScheduleNotFoundError,
} from "./errors.js";
export { ScheduleService } from "./schedule-service.js";
export type {
  PreviewScheduleResult,
  Schedule,
  ScheduleKindHandler,
  ScheduleTargetEnvelope,
  ScheduleTrigger,
} from "./types.js";
