import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";
import type { TaskId } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RecoverOrphanedTasksRequestSchema = z.object({}).strict();
export type RecoverOrphanedTasksRequest = z.infer<typeof RecoverOrphanedTasksRequestSchema>;

export type RecoverOrphanedTasksResponse = undefined;

export type RecoverOrphanedTasksError = DatabaseUnavailable;

export interface RecoverOrphanedTasksDeps {
  readonly repository: TaskRepository;
  readonly query: TaskQueries;
  readonly now: () => Date;
  readonly logger: Logger;
}

/**
 * Sweep tasks still `running` at server boot and mark them
 * `failure: { kind: 'cascade' }`. Catches server-crash cases (OOM, kill -9):
 * the SDK subprocess is a child of the glyph server, so a server death
 * implies the subprocess is gone — no per-task liveness probe is needed.
 * Each id is re-loaded (tracked) before the in-place `fail` + `save`, so a
 * task that ended between the scan and the write is skipped, not clobbered.
 * Per-task failures are warn-logged; only the initial scan fault surfaces.
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
    const q = deps.query;
    return q
      .query(
        async (db) =>
          await db
            .select({ id: q.tasks.id })
            .from(q.tasks)
            .where(eq(q.tasks.status, "running"))
            .all(),
      )
      .andThen((rows) =>
        ResultAsync.fromSafePromise(
          Promise.all(rows.map((row) => reconcile(deps, row.id as TaskId))).then(() => undefined),
        ),
      );
  }
}

async function reconcile(deps: RecoverOrphanedTasksDeps, id: TaskId): Promise<void> {
  const got = await deps.repository.get(id);
  if (got.isErr()) {
    // TaskNotFound (deleted since the scan) / CorruptedTask / DatabaseUnavailable —
    // none is actionable here; warn and move on.
    deps.logger.warn(
      { taskId: id, err: got.error },
      "tasks: failed to load orphaned task for recovery",
    );
    return;
  }
  const task = got.value;
  const failed = task.fail(
    { kind: "cascade", message: "orphaned (server crashed before this task ended)" },
    { now: deps.now().toISOString() },
  );
  if (failed.isErr()) {
    deps.logger.warn(
      { taskId: id, err: failed.error },
      "tasks: failed to mark orphaned task as failure (illegal transition)",
    );
    return;
  }
  const saved = await deps.repository.save(task);
  if (saved.isErr()) {
    deps.logger.warn(
      { taskId: id, err: saved.error },
      "tasks: failed to persist orphaned task failure",
    );
  }
}
