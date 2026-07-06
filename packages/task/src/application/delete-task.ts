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
import type { PurgeFailed, TaskSupervisor } from "./supervision/task-supervisor.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteTaskRequestSchema = z
  .object({ id: TaskIdSchema, purge: z.boolean().optional() })
  .strict();
export type DeleteTaskRequest = z.infer<typeof DeleteTaskRequestSchema>;

export type DeleteTaskResponse = undefined;

export type DeleteTaskError =
  | TaskNotFound
  | CorruptedTask
  | InvalidTransition
  | PurgeFailed
  | DatabaseUnavailable;

export interface DeleteTaskDeps {
  readonly repository: TaskRepository;
  readonly supervisor: TaskSupervisor;
}

/**
 * Remove a task record. The task MUST be terminal — non-terminal input →
 * `InvalidTransition` (cancel it first). When `purge` is set, the workdir +
 * runtime state are removed FIRST, then the row: the row is the durable
 * journal a crash leaves behind, and purge is idempotent, so a `PurgeFailed`
 * leaves the row intact for a later retry instead of orphaning the resources.
 */
export class DeleteTaskUseCase
  implements UseCase<DeleteTaskRequest, DeleteTaskResponse, DeleteTaskError>
{
  constructor(private readonly deps: DeleteTaskDeps) {}

  execute(request: DeleteTaskRequest): UseCaseResult<DeleteTaskResponse, DeleteTaskError> {
    const { id, purge } = DeleteTaskRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repository
      .get(id)
      .andThen((existing) => {
        if (!deleteTaskIsTerminal(existing.status)) {
          return errAsync<void, DeleteTaskError>({
            type: "InvalidTransition",
            from: existing.status,
            eventType: "delete",
          });
        }
        // Purge physical resources BEFORE removing the row; a PurgeFailed keeps
        // the row (the journal) so a later delete retry re-runs the purge.
        const purgeStep: UseCaseResult<void, DeleteTaskError> =
          purge === true ? deps.supervisor.purge(existing) : okAsync(undefined);
        return purgeStep.andThen(() => deps.repository.delete(id));
      })
      .map(() => undefined);
  }
}

function deleteTaskIsTerminal(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}
