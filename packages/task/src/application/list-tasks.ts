import { and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import { projectTaskRow, type TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListTasksRequestSchema = z
  .object({
    agent: z.string().optional(),
    createdSince: z.string().optional(),
    runtime: z.string().optional(),
    status: TaskStatusSchema.optional(),
    origin: z.union([z.string(), z.array(z.string())]).optional(),
    originId: z.string().optional(),
  })
  .strict();
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>;

export const ListTasksResponseSchema = z.array(
  z.object({
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
  }),
);
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

export type ListTasksError = DatabaseUnavailable;

export interface ListTasksDeps {
  readonly query: TaskQueries;
}

/**
 * List persisted tasks, newest first. All filters are pushed down to the
 * indexed SQLite query. Ordering is `createdAt` descending with `id` as the
 * deterministic tiebreak for tasks created in the same millisecond.
 */
export class ListTasksUseCase
  implements UseCase<ListTasksRequest, ListTasksResponse, ListTasksError>
{
  constructor(private readonly deps: ListTasksDeps) {}

  execute(request: ListTasksRequest): UseCaseResult<ListTasksResponse, ListTasksError> {
    const parsed = ListTasksRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query((db) => {
        const filters: SQL[] = [];
        if (parsed.agent !== undefined) filters.push(eq(q.tasks.agent, parsed.agent));
        if (parsed.runtime !== undefined) filters.push(eq(q.tasks.runtime, parsed.runtime));
        if (parsed.createdSince !== undefined) {
          filters.push(gte(q.tasks.createdAt, parsed.createdSince));
        }
        if (parsed.status !== undefined) {
          filters.push(eq(q.tasks.status, parsed.status));
        }
        if (parsed.origin !== undefined) {
          const origins = Array.isArray(parsed.origin) ? parsed.origin : [parsed.origin];
          if (origins.length > 0) filters.push(inArray(q.tasks.origin, origins));
        }
        if (parsed.originId !== undefined) filters.push(eq(q.tasks.originId, parsed.originId));
        const select = db.select().from(q.tasks);
        const rows = filters.length > 0 ? select.where(and(...filters)).all() : select.all();
        return rows.map(projectTaskRow);
      })
      .map((views) =>
        views.sort((a, b) => {
          const byCreated = b.createdAt.localeCompare(a.createdAt);
          return byCreated !== 0 ? byCreated : b.id.localeCompare(a.id);
        }),
      );
  }
}
