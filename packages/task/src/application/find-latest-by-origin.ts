import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import { projectTaskRow, type TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const FindLatestByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type FindLatestByOriginRequest = z.infer<typeof FindLatestByOriginRequestSchema>;

export const FindLatestByOriginResponseSchema = z
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
  .nullable();
export type FindLatestByOriginResponse = z.infer<typeof FindLatestByOriginResponseSchema>;

export type FindLatestByOriginError = DatabaseUnavailable;

export interface FindLatestByOriginDeps {
  readonly query: TaskQueries;
}

/**
 * Most recent task (terminal or not) with this `(origin, originId)`, or `null`
 * when none has been dispatched yet. Origin-agnostic primitive an integration
 * package uses to navigate from one of its own entities to its latest task.
 */
export class FindLatestByOriginUseCase
  implements UseCase<FindLatestByOriginRequest, FindLatestByOriginResponse, FindLatestByOriginError>
{
  constructor(private readonly deps: FindLatestByOriginDeps) {}

  execute(
    request: FindLatestByOriginRequest,
  ): UseCaseResult<FindLatestByOriginResponse, FindLatestByOriginError> {
    const { origin, originId } = FindLatestByOriginRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query((db): FindLatestByOriginResponse => {
      const row = db
        .select()
        .from(q.tasks)
        .where(and(eq(q.tasks.origin, origin), eq(q.tasks.originId, originId)))
        .orderBy(desc(q.tasks.createdAt))
        .limit(1)
        .get();
      return row === undefined ? null : projectTaskRow(row);
    });
  }
}
