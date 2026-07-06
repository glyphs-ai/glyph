import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";
import type { TaskEntity } from "../domain/task-entity.js";
import { TaskOriginSchema } from "../domain/task-origin.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { TaskSupervisor } from "./supervision/task-supervisor.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteTerminalByOriginRequestSchema = z
  .object({ origin: TaskOriginSchema, originId: z.string() })
  .strict();
export type DeleteTerminalByOriginRequest = z.infer<typeof DeleteTerminalByOriginRequestSchema>;

export const DeleteTerminalByOriginResponseSchema = z.object({ deletedCount: z.number() }).strict();
export type DeleteTerminalByOriginResponse = z.infer<typeof DeleteTerminalByOriginResponseSchema>;

export type DeleteTerminalByOriginError = DatabaseUnavailable;

export interface DeleteTerminalByOriginDeps {
  readonly repository: TaskRepository;
  readonly supervisor: TaskSupervisor;
  readonly logger: Logger;
}

/**
 * Cascade-delete every TERMINAL task with this `(origin, originId)`. Each task
 * is purged (workdir + runtime state) FIRST, then its row is removed — the row
 * is the durable journal, so a purge failure skips that task (logged, left for
 * a later GC) instead of orphaning its resources. `deletedCount` counts only
 * fully purged-and-deleted tasks. Origin-agnostic primitive; typed wrappers
 * live in the respective integration package.
 */
export class DeleteTerminalByOriginUseCase
  implements
    UseCase<
      DeleteTerminalByOriginRequest,
      DeleteTerminalByOriginResponse,
      DeleteTerminalByOriginError
    >
{
  constructor(private readonly deps: DeleteTerminalByOriginDeps) {}

  execute(
    request: DeleteTerminalByOriginRequest,
  ): UseCaseResult<DeleteTerminalByOriginResponse, DeleteTerminalByOriginError> {
    const { origin, originId } = DeleteTerminalByOriginRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repository
      .listTerminalByOrigin({ origin, originId })
      .andThen((tasks) => ResultAsync.fromSafePromise(purgeAndDeleteAll(deps, tasks)));
  }
}

async function purgeAndDeleteAll(
  deps: DeleteTerminalByOriginDeps,
  tasks: readonly TaskEntity[],
): Promise<DeleteTerminalByOriginResponse> {
  let deletedCount = 0;
  for (const task of tasks) {
    const purged = await deps.supervisor.purge(task);
    if (purged.isErr()) {
      deps.logger.warn(
        { taskId: task.id, err: purged.error },
        "tasks: purge failed; leaving terminal task row for a later retry",
      );
      continue;
    }
    const deleted = await deps.repository.delete(task.id);
    if (deleted.isErr()) {
      deps.logger.warn(
        { taskId: task.id, err: deleted.error },
        "tasks: failed to delete terminal task row after purge",
      );
      continue;
    }
    deletedCount += 1;
  }
  return { deletedCount };
}
