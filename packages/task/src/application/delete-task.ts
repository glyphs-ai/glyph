import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { CorruptedTask, InvalidTransition } from "../domain/task-entity.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type {
  DatabaseUnavailable,
  TaskNotFound,
  TaskRepository,
} from "../domain/task-repository.js";
import { TERMINAL_TASK_STATUSES } from "../domain/task-status.js";
import type { TaskSupervisor } from "./supervision/index.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteTaskRequestSchema = z
  .object({ id: TaskIdSchema, purge: z.boolean().optional() })
  .strict();
export type DeleteTaskRequest = z.infer<typeof DeleteTaskRequestSchema>;

export type DeleteTaskResponse = void;

export type DeleteTaskError =
  | TaskNotFound
  | CorruptedTask
  | InvalidTransition
  | DatabaseUnavailable;

export interface DeleteTaskDeps {
  readonly repository: TaskRepository;
  readonly supervisor: TaskSupervisor;
}

/**
 * Remove a task record. The task MUST be terminal — non-terminal input →
 * `InvalidTransition` (cancel it first). Row removal IS the "task is deleted"
 * semantic and completes synchronously; `purge` additionally enqueues a
 * fire-and-forget background removal of the workdir + runtime state.
 */
export class DeleteTaskUseCase
  implements UseCase<DeleteTaskRequest, DeleteTaskResponse, DeleteTaskError>
{
  constructor(private readonly deps: DeleteTaskDeps) {}

  execute(request: DeleteTaskRequest): UseCaseResult<DeleteTaskResponse, DeleteTaskError> {
    const { id, purge } = DeleteTaskRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repository.get(id).andThen((existing) => {
      if (!isTerminal(existing.status)) {
        return errAsync<void, DeleteTaskError>({
          type: "InvalidTransition",
          from: existing.status,
          eventType: "delete",
        });
      }
      // Row removal IS the "deleted" semantic and resolves synchronously; a
      // requested purge is enqueued fire-and-forget afterwards. `andThen`
      // (not `map`) keeps the callback on the Result rail with an explicit
      // `okAsync` tail.
      return deps.repository.delete(id).andThen(() => {
        if (purge === true) deps.supervisor.enqueuePurge(existing);
        return okAsync<void, DeleteTaskError>(undefined);
      });
    });
  }
}

function isTerminal(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}
