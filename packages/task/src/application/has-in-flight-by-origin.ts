import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { TERMINAL_TASK_STATUSES } from "../domain/task-status.js";
import type { TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const HasInFlightByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type HasInFlightByOriginRequest = z.infer<typeof HasInFlightByOriginRequestSchema>;

export type HasInFlightByOriginResponse = boolean;

export type HasInFlightByOriginError = DatabaseUnavailable;

export interface HasInFlightByOriginDeps {
  readonly query: TaskQueries;
}

/**
 * True if any task with this `(origin, originId)` is non-terminal.
 * Origin-agnostic primitive used by integration packages to gate re-dispatch.
 */
export class HasInFlightByOriginUseCase
  implements
    UseCase<HasInFlightByOriginRequest, HasInFlightByOriginResponse, HasInFlightByOriginError>
{
  constructor(private readonly deps: HasInFlightByOriginDeps) {}

  execute(
    request: HasInFlightByOriginRequest,
  ): UseCaseResult<HasInFlightByOriginResponse, HasInFlightByOriginError> {
    const { origin, originId } = HasInFlightByOriginRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query((db) =>
        db
          .select({ id: q.tasks.id })
          .from(q.tasks)
          .where(
            and(
              eq(q.tasks.origin, origin),
              eq(q.tasks.originId, originId),
              notInArray(q.tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          )
          .limit(1)
          .get(),
      )
      .map((row) => row !== undefined);
  }
}
