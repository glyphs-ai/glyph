import { and, desc, eq, gte, inArray, notInArray, type SQL } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import type { CorruptedTask, TaskEntity } from "../../domain/task-entity.js";
import type { TaskId } from "../../domain/task-id.js";
import type { TaskOrigin } from "../../domain/task-origin.js";
import type {
  DatabaseUnavailable,
  ListTasksFilter,
  OriginAggregate,
  TaskNotFound,
  TaskRepository,
} from "../../domain/task-repository.js";
import { TERMINAL_TASK_STATUSES } from "../../domain/task-status.js";
import type { Db } from "./task-db.js";
import { TaskMapper } from "./task-mapper.js";
import { type TaskRow, tasks } from "./task-schema.js";

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Drizzle-backed adapter for {@link TaskRepository}. Wraps the synchronous
 * better-sqlite3 calls so any driver fault becomes `DatabaseUnavailable`.
 * Single-id reads surface `CorruptedTask`; bulk reads warn-and-skip a
 * corrupt row (logged) so one bad row never poisons a whole list.
 */
export class DrizzleTaskRepository implements TaskRepository {
  private readonly db: Db;
  private readonly logger: Logger;

  constructor(opts: { db: Db; logger?: Logger }) {
    this.db = opts.db;
    this.logger = opts.logger ?? silentLogger;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: TaskId): ResultAsync<TaskEntity, TaskNotFound | CorruptedTask | DatabaseUnavailable> {
    return this.findById(id).andThen((entity) =>
      entity === undefined ? errAsync({ type: "TaskNotFound" as const, id }) : okAsync(entity),
    );
  }

  findById(id: TaskId): ResultAsync<TaskEntity | undefined, CorruptedTask | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(tasks).where(eq(tasks.id, id)).get())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).andThen((row) => (row === undefined ? okAsync(undefined) : TaskMapper.toEntity(row)));
  }

  findAll(filter: ListTasksFilter): ResultAsync<TaskEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const filters: SQL[] = [];
        if (filter.agent !== undefined) filters.push(eq(tasks.agent, filter.agent));
        if (filter.runtime !== undefined) filters.push(eq(tasks.runtime, filter.runtime));
        if (filter.createdSince !== undefined) {
          filters.push(gte(tasks.createdAt, filter.createdSince));
        }
        if (filter.statuses && filter.statuses.length > 0) {
          filters.push(inArray(tasks.status, [...filter.statuses]));
        }
        if (filter.origin !== undefined) {
          const origins: TaskOrigin[] = Array.isArray(filter.origin)
            ? [...filter.origin]
            : [filter.origin];
          if (origins.length > 0) filters.push(inArray(tasks.origin, origins));
        }
        if (filter.originId !== undefined) filters.push(eq(tasks.originId, filter.originId));
        const query = this.db.select().from(tasks);
        return filters.length > 0 ? query.where(and(...filters)).all() : query.all();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((rows) => this.collectEntities(rows, "findAll"));
  }

  save(entity: TaskEntity): ResultAsync<void, DatabaseUnavailable> {
    const fields = TaskMapper.toRow(entity);
    return ResultAsync.fromPromise(
      (async () => {
        // Upsert in one statement so save is atomic across concurrent
        // connections: insert, or update the existing row on PK conflict.
        this.db
          .insert(tasks)
          .values(fields)
          .onConflictDoUpdate({ target: tasks.id, set: fields })
          .run();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    );
  }

  delete(id: TaskId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(tasks).where(eq(tasks.id, id)).run();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    );
  }

  hasInFlightByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<boolean, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.origin, opts.origin),
              eq(tasks.originId, opts.originId),
              notInArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          )
          .limit(1)
          .get())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((row) => row !== undefined);
  }

  listInFlightByOrigin(opts: {
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
              notInArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          )
          .all())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((rows) => this.collectEntities(rows, "listInFlightByOrigin"));
  }

  findLatestByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity | null, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () =>
        this.db
          .select()
          .from(tasks)
          .where(and(eq(tasks.origin, opts.origin), eq(tasks.originId, opts.originId)))
          .orderBy(desc(tasks.createdAt))
          .limit(1)
          .get())(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((row) => {
      if (row === undefined) return null;
      const entity = TaskMapper.toEntity(row);
      if (entity.isErr()) {
        this.warnCorrupt(row.id, entity.error, "findLatestByOrigin");
        return null;
      }
      return entity.value;
    });
  }

  deleteTerminalByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): ResultAsync<TaskEntity[], DatabaseUnavailable> {
    const predicate = and(
      eq(tasks.origin, opts.origin),
      eq(tasks.originId, opts.originId),
      inArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
    );
    return ResultAsync.fromPromise(
      (async () => {
        const rows = this.db.select().from(tasks).where(predicate).all();
        if (rows.length === 0) return [] as TaskRow[];
        // Map BEFORE deleting so a corrupt row warns-and-skips (matching
        // findAll) while still being dropped by the same predicate. The
        // DELETE reuses the predicate (not an `IN (id, …)` list) to sidestep
        // SQLite's bound-variable limit at large N.
        const rowsToReturn = [...rows];
        this.db.delete(tasks).where(predicate).run();
        return rowsToReturn;
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((rows) => this.collectEntities(rows, "deleteTerminalByOrigin"));
  }

  aggregateByOrigin(opts: {
    readonly origin: string;
    readonly originIds: readonly string[];
    readonly statusIn?: readonly string[];
  }): ResultAsync<ReadonlyMap<string, OriginAggregate>, DatabaseUnavailable> {
    if (opts.originIds.length === 0) return okAsync(new Map());
    return ResultAsync.fromPromise(
      (async () => {
        const predicates: SQL[] = [
          eq(tasks.origin, opts.origin),
          inArray(tasks.originId, [...opts.originIds]),
        ];
        if (opts.statusIn !== undefined && opts.statusIn.length > 0) {
          predicates.push(inArray(tasks.status, [...opts.statusIn]));
        }
        return this.db
          .select({ originId: tasks.originId, status: tasks.status })
          .from(tasks)
          .where(and(...predicates))
          .all();
      })(),
      DrizzleTaskRepository.asDatabaseUnavailable,
    ).map((rows) => {
      const map = new Map<string, { totalCount: number; runningCount: number }>();
      for (const row of rows) {
        if (row.originId === null) continue;
        const current = map.get(row.originId) ?? { totalCount: 0, runningCount: 0 };
        current.totalCount += 1;
        if (row.status === "running") current.runningCount += 1;
        map.set(row.originId, current);
      }
      return map;
    });
  }

  /** Map rows to entities, warning-and-skipping any that fail reconstruction. */
  private collectEntities(rows: readonly TaskRow[], op: string): TaskEntity[] {
    const out: TaskEntity[] = [];
    for (const row of rows) {
      const entity = TaskMapper.toEntity(row);
      if (entity.isErr()) {
        this.warnCorrupt(row.id, entity.error, op);
        continue;
      }
      out.push(entity.value);
    }
    return out;
  }

  private warnCorrupt(taskId: string, error: CorruptedTask, op: string): void {
    this.logger.warn({ taskId, reason: error.reason, op }, "tasks: skipping corrupted task row");
  }
}
