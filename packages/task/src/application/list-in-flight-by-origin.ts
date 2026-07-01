import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { TaskEntity } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListInFlightByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type ListInFlightByOriginRequest = z.infer<typeof ListInFlightByOriginRequestSchema>;

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
export const ListInFlightByOriginResponseSchema = z.array(TaskViewSchema);
export type ListInFlightByOriginResponse = z.infer<typeof ListInFlightByOriginResponseSchema>;

export type ListInFlightByOriginError = DatabaseUnavailable;

export interface ListInFlightByOriginDeps {
  readonly repository: TaskRepository;
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
    return this.deps.repository
      .listInFlightByOrigin({ origin, originId })
      .map((tasks) => tasks.map(toTaskView));
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
