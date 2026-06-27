import { and, desc, eq, gte, inArray, notInArray, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import pino, { type Logger } from "pino";
import { CorruptedTaskError, InvalidTaskIdError } from "./errors.js";
import type * as schema from "./schema.js";
import { type TaskRow, tasks } from "./schema.js";
import { TaskEntity } from "./task-entity.js";
import type {
  ListTaskOpts,
  TaskCancellation,
  TaskFailure,
  TaskOrigin,
  TaskStatus,
  TaskSuccess,
} from "./types.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
import { TASK_ID_RE } from "./validate.js";

const silentLogger: Logger = pino({ level: "silent" });

type Db = BetterSQLite3Database<typeof schema>;

export class TaskRepository {
  private readonly db: Db;
  private readonly logger: Logger;

  constructor(opts: { db: Db; logger?: Logger }) {
    this.db = opts.db;
    this.logger = opts.logger ?? silentLogger;
  }

  async read(id: string): Promise<TaskEntity | null> {
    if (!TASK_ID_RE.test(id)) throw new InvalidTaskIdError(id);
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (row === undefined) return null;
    const task = rowToTask(row);
    if (task.id !== id) {
      // Defensive: row's stored id disagrees with the primary-key id
      // we just selected by. Under SQLite this should be impossible
      // (the PK constraint on `tasks.id` plus the `WHERE tasks.id = id`
      // filter together rule it out), so a fire here means either the
      // schema changed under our feet or someone tampered with the DB
      // out-of-band. We surface a warn and trust the caller's id so the
      // dashboard doesn't silently route a task under the wrong key.
      this.logger.warn(
        { taskId: id, persistedId: task.id },
        "tasks: id mismatch between dir and persisted row",
      );
    }
    return task;
  }

  async save(task: TaskEntity): Promise<void> {
    if (!TASK_ID_RE.test(task.id)) throw new InvalidTaskIdError(task.id);
    const fields = taskToRowFields(task);
    // Upsert in one SQLite statement so save is atomic for concurrent
    // SQL connections: either the row is inserted, or the existing row
    // is updated under the primary-key conflict handler.
    this.db
      .insert(tasks)
      .values(fields)
      .onConflictDoUpdate({ target: tasks.id, set: fields })
      .run();
  }

  async delete(id: string): Promise<void> {
    // Fail-loud on invalid id, matching `read()` / `save()`. A typo in
    // `DELETE /tasks/:tid` is a caller error, not a successful no-op.
    if (!TASK_ID_RE.test(id)) throw new InvalidTaskIdError(id);
    this.db.delete(tasks).where(eq(tasks.id, id)).run();
  }

  async list(opts: ListTaskOpts = {}): Promise<TaskEntity[]> {
    const filters: SQL[] = [];
    if (opts.agent !== undefined) filters.push(eq(tasks.agent, opts.agent));
    if (opts.runtime !== undefined) filters.push(eq(tasks.runtime, opts.runtime));
    if (opts.createdSince !== undefined) filters.push(gte(tasks.createdAt, opts.createdSince));
    if (opts.statuses && opts.statuses.length > 0) {
      filters.push(inArray(tasks.status, [...opts.statuses]));
    }
    if (opts.origin !== undefined) {
      const origins: TaskOrigin[] = Array.isArray(opts.origin)
        ? [...(opts.origin as readonly TaskOrigin[])]
        : [opts.origin as TaskOrigin];
      if (origins.length > 0) filters.push(inArray(tasks.origin, origins));
    }
    if (opts.originId !== undefined) filters.push(eq(tasks.originId, opts.originId));
    const query = this.db.select().from(tasks);
    const rows = filters.length > 0 ? query.where(and(...filters)).all() : query.all();
    const out: TaskEntity[] = [];
    for (const row of rows) {
      try {
        out.push(rowToTask(row));
      } catch (err) {
        this.logger.warn({ taskId: row.id ?? null, err }, "tasks: skipping corrupted task row");
      }
    }
    return out;
  }

  /**
   * True if any task with the given `origin` and `originId` is
   * non-terminal (status not in {@link TERMINAL_TASK_STATUSES}).
   * Origin-agnostic primitive; integration packages wrap it with typed
   * APIs. Queries the typed `(origin, origin_id)` pair so the planner
   * engages `tasks_origin_pair_idx`.
   */
  async hasInFlightByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): Promise<boolean> {
    const row = this.db
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
      .get();
    return row !== undefined;
  }

  /**
   * True if any task with `origin='workflow'` and `originId === nodeId`
   * is non-terminal (status not in {@link TERMINAL_TASK_STATUSES}).
   * Used by the workflow package's `hasInFlightForNode` reverse lookup
   * for worker nodes (see
   * `packages/api/src/wiring/workflow-worker-task-runner.ts`). The node
   * id lives in the first-class `origin_id` column, so this matches on
   * the typed `(origin, origin_id)` pair.
   */
  async hasInFlightForWorkflowNode(nodeId: string): Promise<boolean> {
    const row = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.origin, "workflow"),
          eq(tasks.originId, nodeId),
          notInArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /**
   * List non-terminal tasks with `origin='workflow'` and `originId ===
   * nodeId`. Used by the worker runner's `cancel(nodeId)`
   * reverse-lookup to find which task(s) to cancel.
   *
   * Returns full entities (not just ids) because the caller needs
   * `task.id` for `tasks.cancel(...)` and the per-row error in
   * `rowToTask` is already handled with warn-and-skip.
   */
  async listInFlightForWorkflowNode(nodeId: string): Promise<TaskEntity[]> {
    const rows = this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.origin, "workflow"),
          eq(tasks.originId, nodeId),
          notInArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
        ),
      )
      .all();
    const out: TaskEntity[] = [];
    for (const row of rows) {
      try {
        out.push(rowToTask(row));
      } catch (err) {
        this.logger.warn(
          { taskId: row.id ?? null, err },
          "tasks: skipping corrupted task row in listInFlightForWorkflowNode",
        );
      }
    }
    return out;
  }

  /**
   * Find the most recent task — terminal or not — for a workflow
   * node. Used by the wire-shape projector to enrich
   * `WorkflowNode.taskId` so the dashboard can navigate from a
   * node click to the dispatched task.
   *
   * Differs from {@link listInFlightForWorkflowNode} on two axes:
   *
   *   1. No `notInArray(tasks.status, TERMINAL_TASK_STATUSES)` filter
   *      — a succeeded / failed / cancelled node still wants to
   *      navigate to its task.
   *   2. `ORDER BY createdAt DESC LIMIT 1` — if several rows carry
   *      the same node id, surface the latest task.
   *
   * Returns `null` when no task has been dispatched for the node
   * (only possible in the tight window between node insert and
   * worker dispatch; acceptable for the dashboard).
   *
   * The node id lives in the first-class `origin_id` column; filtering
   * by the typed `(origin, origin_id)` pair stays index-eligible.
   */
  async findTaskByWorkflowNode(nodeId: string): Promise<TaskEntity | null> {
    const row = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.origin, "workflow"), eq(tasks.originId, nodeId)))
      .orderBy(desc(tasks.createdAt))
      .limit(1)
      .get();
    if (row === undefined) return null;
    try {
      return rowToTask(row);
    } catch (err) {
      this.logger.warn(
        { taskId: row.id ?? null, err },
        "tasks: skipping corrupted task row in findTaskByWorkflowNode",
      );
      return null;
    }
  }

  /**
   * Bulk-delete every TERMINAL task with the given `origin` and
   * `originId`. Returns deleted entities so the caller can enqueue
   * per-task background work.
   *
   * Two-step (SELECT → DELETE) instead of `RETURNING` so that we can
   * map rows to entities BEFORE removing them: if a corrupted row
   * makes `rowToTask` throw, we warn-and-skip (matching `list()`'s
   * behaviour) and still drop the DB rows in the same SQL statement.
   *
   * The DELETE uses the SAME predicate as the SELECT (not an `IN (id,
   * id, …)` list) so we sidestep SQLite's bound-variable limit at
   * large N.
   */
  async deleteTerminalByOrigin(opts: {
    readonly origin: string;
    readonly originId: string;
  }): Promise<TaskEntity[]> {
    const predicate = and(
      eq(tasks.origin, opts.origin),
      eq(tasks.originId, opts.originId),
      inArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
    );
    const rows = this.db.select().from(tasks).where(predicate).all();
    if (rows.length === 0) return [];
    const entities: TaskEntity[] = [];
    for (const row of rows) {
      try {
        entities.push(rowToTask(row));
      } catch (err) {
        this.logger.warn(
          { taskId: row.id ?? null, err },
          "tasks: skipping corrupted task row during deleteTerminalByOrigin",
        );
      }
    }
    this.db.delete(tasks).where(predicate).run();
    return entities;
  }

  /**
   * Origin-agnostic aggregation primitive. Returns per-`originId`
   * counts for tasks matching the given `origin` and the listed
   * `originIds`. Single `origin` per call. Queries the typed `(origin,
   * origin_id)` pair so the planner engages `tasks_origin_pair_idx`.
   */
  async aggregateByOrigin(opts: {
    readonly origin: string;
    readonly originIds: readonly string[];
    readonly statusIn?: readonly string[];
  }): Promise<ReadonlyMap<string, { readonly totalCount: number; readonly runningCount: number }>> {
    if (opts.originIds.length === 0) return new Map();

    const predicates: SQL[] = [
      eq(tasks.origin, opts.origin),
      inArray(tasks.originId, [...opts.originIds]),
    ];
    if (opts.statusIn !== undefined && opts.statusIn.length > 0) {
      predicates.push(inArray(tasks.status, [...opts.statusIn]));
    }

    const matchedRows = this.db
      .select({
        originId: tasks.originId,
        status: tasks.status,
      })
      .from(tasks)
      .where(and(...predicates))
      .all();

    const map = new Map<string, { totalCount: number; runningCount: number }>();
    for (const row of matchedRows) {
      if (row.originId === null) continue;
      const current = map.get(row.originId) ?? { totalCount: 0, runningCount: 0 };
      current.totalCount += 1;
      if (row.status === "running") {
        current.runningCount += 1;
      }
      map.set(row.originId, current);
    }
    return map;
  }
}

function taskToRowFields(task: TaskEntity): {
  id: string;
  agent: string;
  runtime: string | null;
  status: TaskStatus;
  brief: string;
  details: string | null;
  origin: TaskOrigin;
  originId: string | null;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  success: string | null;
  failure: string | null;
  cancellation: string | null;
  metadata: string;
} {
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  let runtime: string | null = null;
  let metaForJson: Record<string, unknown> = meta;
  if (typeof meta.runtime === "string") {
    runtime = meta.runtime;
    const { runtime: _r, ...rest } = meta;
    metaForJson = rest;
  }
  return {
    id: task.id,
    agent: task.agent,
    runtime,
    status: task.status,
    brief: task.brief,
    details: task.details ?? null,
    origin: task.origin,
    originId: task.originId ?? null,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt ?? null,
    success: task.success !== undefined ? JSON.stringify(task.success) : null,
    failure: task.failure !== undefined ? JSON.stringify(task.failure) : null,
    cancellation: task.cancellation !== undefined ? JSON.stringify(task.cancellation) : null,
    metadata: JSON.stringify(metaForJson),
  };
}

function rowToTask(row: TaskRow): TaskEntity {
  let metaParsed: unknown;
  try {
    metaParsed = JSON.parse(row.metadata);
  } catch (err) {
    throw new CorruptedTaskError(
      row.id,
      `task.metadata is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (metaParsed === null || typeof metaParsed !== "object" || Array.isArray(metaParsed)) {
    throw new CorruptedTaskError(row.id, "task.metadata must decode to an object");
  }
  let metadata: Record<string, unknown> = metaParsed as Record<string, unknown>;
  if (row.runtime !== null) {
    metadata = { ...metadata, runtime: row.runtime };
  }

  const success = parseJsonColumn<TaskSuccess>(row.id, "success", row.success);
  const failure = parseJsonColumn<TaskFailure>(row.id, "failure", row.failure);
  const cancellation = parseJsonColumn<TaskCancellation>(row.id, "cancellation", row.cancellation);

  return TaskEntity.fromStored({
    id: row.id,
    agent: row.agent,
    brief: row.brief,
    ...(row.details !== null ? { details: row.details } : {}),
    origin: row.origin as TaskOrigin,
    ...(row.originId !== null ? { originId: row.originId } : {}),
    status: row.status as TaskStatus,
    metadata,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
    ...(success !== undefined ? { success } : {}),
    ...(failure !== undefined ? { failure } : {}),
    ...(cancellation !== undefined ? { cancellation } : {}),
  });
}

function parseJsonColumn<T>(id: string, name: string, raw: string | null): T | undefined {
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorruptedTaskError(
      id,
      `task.${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptedTaskError(id, `task.${name} must decode to an object`);
  }
  return parsed as T;
}
