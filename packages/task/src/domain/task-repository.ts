import type { ResultAsync } from "neverthrow";
import type { CorruptedTask, TaskEntity } from "./task-entity.js";
import type { TaskId } from "./task-id.js";
import type { TaskOrigin } from "./task-origin.js";
import type { TaskStatus } from "./task-status.js";

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

/** Filter for {@link TaskRepository.findAll}. All clauses are AND-combined. */
export interface ListTasksFilter {
  readonly agent?: string;
  /** Drop tasks whose `createdAt` is strictly before this ISO-8601 timestamp. */
  readonly createdSince?: string;
  /** Match `metadata.runtime` (promoted to the indexed `runtime` column). */
  readonly runtime?: string;
  readonly statuses?: readonly TaskStatus[];
  /** Single origin or any of several. */
  readonly origin?: TaskOrigin | readonly TaskOrigin[];
  /** Match the typed `origin_id` column; almost always paired with `origin`. */
  readonly originId?: string;
}

/** Per-origin aggregate counts returned by {@link TaskRepository.aggregateByOrigin}. */
export interface OriginAggregate {
  readonly totalCount: number;
  readonly runningCount: number;
}

/**
 * Persistence port for the task aggregate. Reads return {@link TaskEntity};
 * row shapes stay inside infrastructure. Error unions are inlined per
 * signature (no per-op alias). `findById` treats absence as `undefined`;
 * `get` asserts existence. `findAll` and the bulk queries warn-and-skip a
 * row that fails reconstruction, so they never surface `CorruptedTask`;
 * single-id reads surface it so a corrupted "open task" becomes a 5xx.
 */
export interface TaskRepository {
  get(id: TaskId): ResultAsync<TaskEntity, TaskNotFound | CorruptedTask | DatabaseUnavailable>;
  findById(id: TaskId): ResultAsync<TaskEntity | undefined, CorruptedTask | DatabaseUnavailable>;
  findAll(filter: ListTasksFilter): ResultAsync<TaskEntity[], DatabaseUnavailable>;
  save(entity: TaskEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: TaskId): ResultAsync<void, DatabaseUnavailable>;

  /** True if any task with this `(origin, originId)` is non-terminal. */
  hasInFlightByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<boolean, DatabaseUnavailable>;

  /** Non-terminal tasks with this `(origin, originId)`. */
  listInFlightByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity[], DatabaseUnavailable>;

  /** Most recent task (terminal or not) with this `(origin, originId)`, or `null`. */
  findLatestByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity | null, DatabaseUnavailable>;

  /** Bulk-delete every TERMINAL task with this `(origin, originId)`; returns them. */
  deleteTerminalByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity[], DatabaseUnavailable>;

  /** Per-`originId` total / running counts for tasks of one `origin`. */
  aggregateByOrigin(opts: {
    readonly origin: string;
    readonly originIds: readonly string[];
    readonly statusIn?: readonly string[];
  }): ResultAsync<ReadonlyMap<string, OriginAggregate>, DatabaseUnavailable>;
}
