import type { ResultAsync } from "neverthrow";
import type { CorruptedTask, TaskEntity } from "./task-entity.js";
import type { TaskId } from "./task-id.js";

/**
 * Persistence error atoms — discriminated-union values flowing through
 * `Result`, not thrown exceptions. `TaskNotFound` is a normal business
 * outcome (id resolves to zero rows), distinct from `DatabaseUnavailable`
 * (the IO layer faulted). `CorruptedTask` (a row that fails entity
 * reconstruction) is declared in `task-entity.ts`.
 */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type TaskNotFound = {
  readonly type: "TaskNotFound";
  readonly id: string;
};

/**
 * Write-side persistence port for the task aggregate. Reads return
 * {@link TaskEntity}; row shapes stay inside infrastructure. Change-tracking
 * lives in the adapter: `get` snapshots the loaded row, `save` diffs against it
 * (untracked ⇒ INSERT, tracked ⇒ UPDATE only the changed columns). `get`
 * surfaces `CorruptedTask` so a corrupted "open task" becomes a 5xx rather
 * than a silent skip. The read-side query model lives on `TaskQueries`
 * (`../infrastructure/drizzle/task-queries.ts`).
 */
export interface TaskRepository {
  get(id: TaskId): ResultAsync<TaskEntity, TaskNotFound | CorruptedTask | DatabaseUnavailable>;
  save(entity: TaskEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: TaskId): ResultAsync<void, DatabaseUnavailable>;

  /**
   * TERMINAL tasks with this `(origin, originId)`, as tracked aggregates —
   * the write-side finder that drives the cascade purge+delete. A row that
   * fails reconstruction is warn-and-skipped (it can't be purged safely, so it
   * is left in place rather than deleted), so this never surfaces
   * `CorruptedTask`.
   */
  listTerminalByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity[], DatabaseUnavailable>;
}
