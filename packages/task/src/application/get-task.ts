import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import type { CorruptedTask, TaskEntity } from "../domain/task-entity.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetTaskRequestSchema = z.object({ id: TaskIdSchema }).strict();
export type GetTaskRequest = z.infer<typeof GetTaskRequestSchema>;

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
export const GetTaskResponseSchema = TaskViewSchema.nullable();
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;

export type GetTaskError = CorruptedTask | DatabaseUnavailable;

export interface GetTaskDeps {
  readonly repository: TaskRepository;
  readonly runtimeRegistry: RuntimeRegistry;
}

/**
 * Read one task by id; `null` when absent. A running task is enriched with
 * the runtime's live `lastActiveAtRuntime` (best-effort — a runtime fault or
 * unregistered runtime leaves the task unenriched). Terminal tasks are
 * returned as-is because their runtime state dir may already be purged.
 */
export class GetTaskUseCase implements UseCase<GetTaskRequest, GetTaskResponse, GetTaskError> {
  constructor(private readonly deps: GetTaskDeps) {}

  execute(request: GetTaskRequest): UseCaseResult<GetTaskResponse, GetTaskError> {
    const { id } = GetTaskRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repository.findById(id).andThen((task) => {
      if (task === undefined) return okAsync<GetTaskResponse, GetTaskError>(null);
      if (task.status !== "running")
        return okAsync<GetTaskResponse, GetTaskError>(toTaskView(task));
      return enrichWithRuntimeMetadata(deps, task).map(
        (enriched): GetTaskResponse => toTaskView(enriched),
      );
    });
  }
}

/**
 * Fold the runtime's `lastActiveAt` into a running task's metadata bag. Pure
 * (never mutates input, never persists); returns the task unchanged when the
 * runtime is unregistered, has no session id, or reports no activity.
 */
function enrichWithRuntimeMetadata(
  deps: GetTaskDeps,
  task: TaskEntity,
): UseCaseResult<TaskEntity, never> {
  const runtimeName = task.metadataString("runtime");
  if (runtimeName === undefined) return okAsync(task);
  const found = deps.runtimeRegistry.get(runtimeName);
  if (found.isErr()) return okAsync(task);
  const runtimeSessionId = task.metadataString("runtimeSessionId");
  if (runtimeSessionId === undefined) return okAsync(task);
  // readMetadata is best-effort (never-failing Result) — a runtime fault
  // resolves to null rather than breaking the read.
  return found.value.readMetadata(runtimeSessionId).map((meta): TaskEntity => {
    if (meta === null || meta.lastActiveAt === null) return task;
    return task.withMetadata({ ...task.metadata, lastActiveAtRuntime: meta.lastActiveAt });
  });
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
