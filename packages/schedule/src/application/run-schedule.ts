import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";
import { nextRuns } from "../domain/schedule/cron.js";
import type { ScheduleCorruption } from "../domain/schedule/schedule-errors.js";
import { type InvalidScheduleId, parseScheduleId } from "../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleNotFound,
  ScheduleRepository,
} from "../domain/schedule/schedule-repository.js";
import type { ScheduleKindNotRegistered } from "./ports/schedule-kind-handler.js";
import type { ScheduleKindRegistry } from "./ports/schedule-kind-registry.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RunScheduleRequestSchema = z
  .object({ id: z.string(), expectedKind: z.string().optional() })
  .strict();
export type RunScheduleRequest = z.infer<typeof RunScheduleRequestSchema>;

export const RunScheduleResponseSchema = z.object({ dispatchId: z.string() }).strict();
export type RunScheduleResponse = z.infer<typeof RunScheduleResponseSchema>;

export type RunScheduleError =
  | InvalidScheduleId
  | ScheduleNotFound
  | ScheduleCorruption
  | ScheduleKindNotRegistered
  | DatabaseUnavailable;

export interface RunScheduleDeps {
  readonly repo: ScheduleRepository;
  readonly registry: ScheduleKindRegistry;
  readonly now: () => Date;
}

/**
 * Manual fire — bypasses the `enabled` gate and the concurrency check. Records
 * `last_fired_at` and recomputes `next_fire_at`, but does NOT re-arm: the
 * existing timer continues independently. Returns the handler's substrate-side
 * id as `dispatchId`. Depends on the repo + registry directly (not the
 * engine), since it touches no timer.
 */
export class RunScheduleUseCase
  implements UseCase<RunScheduleRequest, RunScheduleResponse, RunScheduleError>
{
  constructor(private readonly deps: RunScheduleDeps) {}
  execute(request: RunScheduleRequest): UseCaseResult<RunScheduleResponse, RunScheduleError> {
    const parsed = RunScheduleRequestSchema.parse(request);
    const deps = this.deps;
    return safeTry<RunScheduleResponse, RunScheduleError>(async function* () {
      const id = yield* parseScheduleId(parsed.id);
      const entity = yield* deps.repo.get(id);
      // A kind-scoped run (e.g. POST /schedules/task/:sid/run) treats a row of a
      // different kind as absent — the wire must not leak the actual kind.
      if (parsed.expectedKind !== undefined && entity.target.kind !== parsed.expectedKind) {
        return err({ type: "ScheduleNotFound" as const, id });
      }
      const handler = yield* deps.registry.handlerFor(entity.target.kind);

      const now = deps.now();
      const firedAt = now.toISOString();
      const dispatched = yield* handler
        .dispatch({ scheduleId: id, firedAt, data: entity.target.data })
        .mapErr(
          (fault): DatabaseUnavailable => ({ type: "DatabaseUnavailable", cause: fault.cause }),
        );
      const [nextIso] = nextRuns(entity.trigger.expr, entity.trigger.tz, now, 1);
      entity.recordFired(firedAt, nextIso);
      yield* deps.repo.save(entity);
      return ok({ dispatchId: dispatched.id });
    });
  }
}
