import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import { TaskOriginSchema } from "../domain/task-origin.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { TaskStatusSchema, TERMINAL_TASK_STATUSES } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import { projectTaskRow, type TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListInFlightByOriginRequestSchema = z
  .object({ origin: TaskOriginSchema, originId: z.string() })
  .strict();
export type ListInFlightByOriginRequest = z.infer<typeof ListInFlightByOriginRequestSchema>;

export const ListInFlightByOriginResponseSchema = z.array(
  z
    .object({
      id: TaskIdSchema,
      agent: z.string(),
      brief: z.string(),
      details: z.string().optional(),
      origin: z.string(),
      originId: z.string().optional(),
      status: TaskStatusSchema,
      metadata: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
      startedAt: z.string(),
      endedAt: z.string().optional(),
      success: TaskSuccessSchema.optional(),
      failure: TaskFailureSchema.optional(),
      cancellation: TaskCancellationSchema.optional(),
    })
    .strict(),
);
export type ListInFlightByOriginResponse = z.infer<typeof ListInFlightByOriginResponseSchema>;

export type ListInFlightByOriginError = DatabaseUnavailable;

export interface ListInFlightByOriginDeps {
  readonly query: TaskQueries;
}

/**
 * Non-terminal tasks with this `(origin, originId)`. Origin-agnostic primitive
 * an integration package uses when it needs each in-flight `task.id` — e.g. to
 * cancel every live run tied to one of its own entities.
 */
export class ListInFlightByOriginUseCase
  implements
    UseCase<ListInFlightByOriginRequest, ListInFlightByOriginResponse, ListInFlightByOriginError>
{
  constructor(private readonly deps: ListInFlightByOriginDeps) {}

  execute(
    request: ListInFlightByOriginRequest,
  ): UseCaseResult<ListInFlightByOriginResponse, ListInFlightByOriginError> {
    const { origin, originId } = ListInFlightByOriginRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query(async (db) =>
      (
        await db
          .select()
          .from(q.tasks)
          .where(
            and(
              eq(q.tasks.origin, origin),
              eq(q.tasks.originId, originId),
              notInArray(q.tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          )
          .all()
      ).map(projectTaskRow),
    );
  }
}
