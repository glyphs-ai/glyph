import { err, ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";
import type {
  ScheduleCorruption,
  ScheduleEnabled,
  ScheduleHasInFlight,
} from "../domain/schedule/schedule-errors.js";
import { type InvalidScheduleId, parseScheduleId } from "../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleNotFound,
  ScheduleRepository,
} from "../domain/schedule/schedule-repository.js";
import type { ScheduleEngine } from "./engine/schedule-engine.js";
import type { ScheduleKindNotRegistered } from "./ports/schedule-kind-handler.js";
import type { ScheduleKindRegistry } from "./ports/schedule-kind-registry.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteScheduleRequestSchema = z.object({ id: z.string() }).strict();
export type DeleteScheduleRequest = z.infer<typeof DeleteScheduleRequestSchema>;

export const DeleteScheduleResponseSchema = z.object({ deletedDispatchCount: z.number() });
export type DeleteScheduleResponse = z.infer<typeof DeleteScheduleResponseSchema>;

export type DeleteScheduleError =
  | InvalidScheduleId
  | ScheduleNotFound
  | ScheduleCorruption
  | ScheduleEnabled
  | ScheduleHasInFlight
  | ScheduleKindNotRegistered
  | DatabaseUnavailable;

export interface DeleteScheduleDeps {
  readonly repo: ScheduleRepository;
  readonly registry: ScheduleKindRegistry;
  readonly engine: ScheduleEngine;
}

/**
 * Cascade-delete a schedule with every TERMINAL unit-of-work it fired (via the
 * handler's `deleteForSchedule`). In-flight protection is two-layered: the
 * pre-flight `hasInFlightForSchedule` guard rejects with
 * {@link ScheduleHasInFlight} when a dispatch is running, and the cascade
 * filters to terminal status only. Ordering: cancel the timer FIRST (so the
 * clock can't dispatch mid-cascade), THEN cascade, THEN re-check
 * `hasInFlightForSchedule` (TOCTOU defence against a racing manual run), THEN
 * delete the row. A missing row is `ScheduleNotFound`; an enabled row is
 * `ScheduleEnabled` (disable first).
 */
export class DeleteScheduleUseCase
  implements UseCase<DeleteScheduleRequest, DeleteScheduleResponse, DeleteScheduleError>
{
  constructor(private readonly deps: DeleteScheduleDeps) {}
  execute(
    request: DeleteScheduleRequest,
  ): UseCaseResult<DeleteScheduleResponse, DeleteScheduleError> {
    const parsed = DeleteScheduleRequestSchema.parse(request);
    const deps = this.deps;
    return safeTry<DeleteScheduleResponse, DeleteScheduleError>(async function* () {
      const id = yield* parseScheduleId(parsed.id);
      const existing = yield* deps.repo.get(id);
      if (existing.enabled) return err({ type: "ScheduleEnabled" as const, id });
      const handler = yield* deps.registry.handlerFor(existing.target.kind);

      const inFlightBefore = yield* ResultAsync.fromPromise(
        handler.hasInFlightForSchedule(id),
        asDatabaseUnavailable,
      );
      if (inFlightBefore) return err({ type: "ScheduleHasInFlight" as const, id });

      deps.engine.cancel(id);
      const { deletedCount } = yield* ResultAsync.fromPromise(
        handler.deleteForSchedule(id),
        asDatabaseUnavailable,
      );

      const inFlightAfter = yield* ResultAsync.fromPromise(
        handler.hasInFlightForSchedule(id),
        asDatabaseUnavailable,
      );
      // TOCTOU: a concurrent manual run() slipped a fresh dispatch in between
      // our original check and the cascade. The cascade's terminal-only filter
      // left it alone; refuse the delete so no orphan dispatch points at a dead
      // schedule.
      if (inFlightAfter) return err({ type: "ScheduleHasInFlight" as const, id });

      yield* deps.repo.delete(id);
      return ok({ deletedDispatchCount: deletedCount });
    });
  }
}

function asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
  return { type: "DatabaseUnavailable", cause };
}
