import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";
import type { TaskEntity } from "../domain/task-entity.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RecoverOrphanedTasksRequestSchema = z.object({}).strict();
export type RecoverOrphanedTasksRequest = z.infer<typeof RecoverOrphanedTasksRequestSchema>;

export type RecoverOrphanedTasksResponse = undefined;

export type RecoverOrphanedTasksError = DatabaseUnavailable;

export interface RecoverOrphanedTasksDeps {
  readonly repository: TaskRepository;
  readonly now: () => Date;
  readonly logger: Logger;
}

/**
 * Sweep tasks still `running` at server boot and mark them
 * `failure: { kind: 'cascade' }`. Catches server-crash cases (OOM, kill -9):
 * the SDK subprocess is a child of the glyph server, so a server death
 * implies the subprocess is gone — no per-task liveness probe is needed.
 * Per-task failures are warn-logged; only the initial list fault surfaces.
 */
export class RecoverOrphanedTasksUseCase
  implements
    UseCase<RecoverOrphanedTasksRequest, RecoverOrphanedTasksResponse, RecoverOrphanedTasksError>
{
  constructor(private readonly deps: RecoverOrphanedTasksDeps) {}

  execute(
    request: RecoverOrphanedTasksRequest,
  ): UseCaseResult<RecoverOrphanedTasksResponse, RecoverOrphanedTasksError> {
    RecoverOrphanedTasksRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repository
      .findAll({ statuses: ["running"] })
      .andThen((tasks) =>
        ResultAsync.fromSafePromise(
          Promise.all(tasks.map((task) => reconcile(deps, task))).then(() => undefined),
        ),
      );
  }
}

async function reconcile(deps: RecoverOrphanedTasksDeps, task: TaskEntity): Promise<void> {
  const failed = task.fail(
    { kind: "cascade", message: "orphaned (server crashed before this task ended)" },
    { now: deps.now().toISOString() },
  );
  if (failed.isErr()) {
    deps.logger.warn(
      { taskId: task.id, err: failed.error },
      "tasks: failed to mark orphaned task as failure (illegal transition)",
    );
    return;
  }
  const saved = await deps.repository.save(failed.value);
  if (saved.isErr()) {
    deps.logger.warn(
      { taskId: task.id, err: saved.error },
      "tasks: failed to persist orphaned task failure",
    );
  }
}
