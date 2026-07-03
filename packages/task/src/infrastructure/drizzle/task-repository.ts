import { and, eq, inArray } from "drizzle-orm";
import { err, okAsync, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import type { CorruptedTask, TaskEntity } from "../../domain/task-entity.js";
import type { TaskId } from "../../domain/task-id.js";
import type {
  DatabaseUnavailable,
  TaskNotFound,
  TaskRepository,
} from "../../domain/task-repository.js";
import { TERMINAL_TASK_STATUSES } from "../../domain/task-status.js";
import type { Db } from "./task-db.js";
import { TaskMapper } from "./task-mapper.js";
import { type NewTaskRow, tasks } from "./task-schema.js";

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Drizzle-backed write-side adapter for {@link TaskRepository}.
 *
 * Change-tracking lives here, not on the entity: `get` snapshots the loaded
 * row into a `WeakMap` keyed on the returned entity; `save` looks the entity
 * up — absent ⇒ INSERT (a freshly `create()`d task), present ⇒ diff the
 * current row against the snapshot and UPDATE only the changed columns (or
 * no-op). The `WeakMap` releases entries when the entity is garbage-collected,
 * so there is nothing to clean up per request. `get` surfaces `CorruptedTask`
 * so a corrupted "open task" becomes a 5xx rather than a silent skip; the
 * read-side query model (list projections) lives on `TaskQueries`.
 *
 * `TaskMapper.toEntity` (the row → aggregate reconstruction, which validates
 * every field) is used only by this write-side adapter. Read use-cases must
 * project rows via `projectTaskRow`, never reconstruct entities.
 */
export class DrizzleTaskRepository implements TaskRepository {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly snapshots = new WeakMap<TaskEntity, NewTaskRow>();

  constructor(opts: { db: Db; logger?: Logger }) {
    this.db = opts.db;
    this.logger = opts.logger ?? silentLogger;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: TaskId): ResultAsync<TaskEntity, TaskNotFound | CorruptedTask | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(tasks).where(eq(tasks.id, id)).get())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).andThen((row) => {
      if (row === undefined) {
        return err<TaskEntity, TaskNotFound | CorruptedTask>({ type: "TaskNotFound" as const, id });
      }
      return TaskMapper.toEntity(row).map((entity) => {
        this.track(entity, TaskMapper.toRow(entity));
        return entity;
      });
    });
  }

  save(entity: TaskEntity): ResultAsync<void, DatabaseUnavailable> {
    const current = TaskMapper.toRow(entity);
    const snapshot = this.snapshots.get(entity);
    // Untracked entity ⇒ never loaded ⇒ INSERT (a freshly created task).
    if (snapshot === undefined) {
      return ResultAsync.fromPromise(
        (async () => {
          this.db.insert(tasks).values(current).run();
        })(),
        DrizzleTaskRepository.asDatabaseUnavailable,
      ).map(() => this.track(entity, current));
    }
    // Tracked entity: UPDATE only the columns that diverged from the snapshot.
    const diff = diffRow(snapshot, current);
    if (Object.keys(diff).length === 0) return okAsync(undefined);
    return ResultAsync.fromPromise(
      (async () => {
        this.db.update(tasks).set(diff).where(eq(tasks.id, entity.id)).run();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map(() => this.track(entity, current));
  }

  delete(id: TaskId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(tasks).where(eq(tasks.id, id)).run();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    );
  }

  listTerminalByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.origin, opts.origin),
              eq(tasks.originId, opts.originId),
              inArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          )
          .all())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((rows) => {
      const out: TaskEntity[] = [];
      for (const row of rows) {
        const entity = TaskMapper.toEntity(row);
        if (entity.isErr()) {
          // A corrupt row can't be reconstructed, so it can't be purged
          // safely — leave it in place (logged) rather than deleting and
          // orphaning its physical resources.
          this.logger.warn(
            { taskId: row.id, reason: entity.error.reason, op: "listTerminalByOrigin" },
            "tasks: skipping corrupted task row",
          );
          continue;
        }
        this.track(entity.value, TaskMapper.toRow(entity.value));
        out.push(entity.value);
      }
      return out;
    });
  }

  /** Record the persisted row as the entity's tracked snapshot. */
  private track(entity: TaskEntity, row: NewTaskRow): void {
    this.snapshots.set(entity, row);
  }
}

/**
 * Shallow column-wise diff of two rows: the subset of `current`'s columns
 * whose value differs from `snapshot`. Every task column is a primitive
 * (string | null) — the JSON payloads (`success` / `failure` / `cancellation`
 * / `metadata`) are serialized to strings by the mapper — so identity
 * comparison is exact.
 */
function diffRow(snapshot: NewTaskRow, current: NewTaskRow): Partial<NewTaskRow> {
  const diff: Partial<NewTaskRow> = {};
  for (const key of Object.keys(current) as (keyof NewTaskRow)[]) {
    if (current[key] !== snapshot[key]) {
      diff[key] = current[key] as NewTaskRow[keyof NewTaskRow] as never;
    }
  }
  return diff;
}
