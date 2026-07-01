import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { TaskEntity } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const FindLatestByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type FindLatestByOriginRequest = z.infer<typeof FindLatestByOriginRequestSchema>;

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
export const FindLatestByOriginResponseSchema = TaskViewSchema.nullable();
export type FindLatestByOriginResponse = z.infer<typeof FindLatestByOriginResponseSchema>;

export type FindLatestByOriginError = DatabaseUnavailable;

export interface FindLatestByOriginDeps {
  readonly repository: TaskRepository;
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
    return this.deps.repository
      .findLatestByOrigin({ origin, originId })
      .map((task): FindLatestByOriginResponse => (task === null ? null : toTaskView(task)));
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
