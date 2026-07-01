import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { TaskEntity } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type {
  DatabaseUnavailable,
  ListTasksFilter,
  TaskRepository,
} from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListTasksRequestSchema = z
  .object({
    agent: z.string().optional(),
    createdSince: z.string().optional(),
    runtime: z.string().optional(),
    statuses: z.array(TaskStatusSchema).optional(),
    origin: z.union([z.string(), z.array(z.string())]).optional(),
    originId: z.string().optional(),
  })
  .strict();
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>;

const TaskViewSchema = z.object({
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
});
export const ListTasksResponseSchema = z.array(TaskViewSchema);
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

export type ListTasksError = DatabaseUnavailable;

export interface ListTasksDeps {
  readonly repository: TaskRepository;
}

/**
 * List persisted tasks, newest first. All filters are pushed down to the
 * indexed SQLite query; corrupted rows are warn-and-skipped in the repository.
 * Ordering is `createdAt` descending with `id` as the deterministic tiebreak
 * for tasks created in the same millisecond.
 */
export class ListTasksUseCase
  implements UseCase<ListTasksRequest, ListTasksResponse, ListTasksError>
{
  constructor(private readonly deps: ListTasksDeps) {}

  execute(request: ListTasksRequest): UseCaseResult<ListTasksResponse, ListTasksError> {
    const parsed = ListTasksRequestSchema.parse(request);
    // Build the filter with only the keys actually present — under
    // exactOptionalPropertyTypes a `key: undefined` is not assignable to an
    // optional `key?:` property.
    const filter: ListTasksFilter = {
      ...(parsed.agent !== undefined ? { agent: parsed.agent } : {}),
      ...(parsed.createdSince !== undefined ? { createdSince: parsed.createdSince } : {}),
      ...(parsed.runtime !== undefined ? { runtime: parsed.runtime } : {}),
      ...(parsed.statuses !== undefined ? { statuses: parsed.statuses } : {}),
      ...(parsed.origin !== undefined ? { origin: parsed.origin } : {}),
      ...(parsed.originId !== undefined ? { originId: parsed.originId } : {}),
    };
    return this.deps.repository.findAll(filter).map((tasks) =>
      tasks
        .sort((a, b) => {
          const byCreated = b.createdAt.localeCompare(a.createdAt);
          return byCreated !== 0 ? byCreated : b.id.localeCompare(a.id);
        })
        .map(toTaskView),
    );
  }
}

function toTaskView(task: TaskEntity): z.infer<typeof TaskViewSchema> {
  return {
    id: task.id,
    agent: task.agent,
    brief: task.brief,
    ...(task.details !== undefined ? { details: task.details } : {}),
    origin: task.origin,
    ...(task.originId !== undefined ? { originId: task.originId } : {}),
    status: task.status,
    metadata: { ...task.metadata },
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
    ...(task.success !== undefined ? { success: task.success } : {}),
    ...(task.failure !== undefined ? { failure: task.failure } : {}),
    ...(task.cancellation !== undefined ? { cancellation: task.cancellation } : {}),
  };
}
