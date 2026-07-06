import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { CorruptedTask, InvalidTransition } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskNotFound } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type { ManagerShuttingDown, TaskSupervisor } from "./supervision/task-supervisor.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CancelTaskRequestSchema = z.object({ id: TaskIdSchema }).strict();
export type CancelTaskRequest = z.infer<typeof CancelTaskRequestSchema>;

export const CancelTaskResponseSchema = z
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
  .strict();
export type CancelTaskResponse = z.infer<typeof CancelTaskResponseSchema>;

export type CancelTaskError =
  | ManagerShuttingDown
  | TaskNotFound
  | InvalidTransition
  | CorruptedTask
  | DatabaseUnavailable;

export interface CancelTaskDeps {
  readonly supervisor: TaskSupervisor;
}

/**
 * Cancel a running task. Delegates the stateful kill-and-await mechanics to
 * the supervisor: terminal input → `InvalidTransition`, a concurrent same-id
 * cancel resolves consistently, and the orphan path (no live subprocess)
 * still persists a terminal row.
 */
export class CancelTaskUseCase
  implements UseCase<CancelTaskRequest, CancelTaskResponse, CancelTaskError>
{
  constructor(private readonly deps: CancelTaskDeps) {}

  execute(request: CancelTaskRequest): UseCaseResult<CancelTaskResponse, CancelTaskError> {
    const { id } = CancelTaskRequestSchema.parse(request);
    return this.deps.supervisor.cancel(id).map((task) => ({
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
    }));
  }
}
