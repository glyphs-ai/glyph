import { ResultAsync } from "neverthrow";
import type { TaskCancellation } from "../../domain/task-cancellation.js";
import type { TaskFailure } from "../../domain/task-failure.js";
import type { TaskId } from "../../domain/task-id.js";
import type { TaskOrigin } from "../../domain/task-origin.js";
import type { DatabaseUnavailable } from "../../domain/task-repository.js";
import type { TaskStatus } from "../../domain/task-status.js";
import type { TaskSuccess } from "../../domain/task-success.js";
import { TASK_ARTIFACT_SUBDIR } from "../file/local-task-sandbox.js";
import type { Db } from "./task-db.js";
import { type TaskRow, tasks } from "./task-schema.js";

/**
 * Read-side port for the task CQRS query model. Exposes the table so read
 * use-cases compose their own SELECTs (by-id, filtered list, by-origin
 * lookups, aggregates) and run them through {@link TaskQueries.query}, which
 * captures a driver throw as `DatabaseUnavailable`. The interface lives beside
 * its Drizzle implementation (not in the domain) because it deliberately
 * exposes the Drizzle handle + table object — the read side is intentionally
 * infrastructure-coupled. The private `db` is never handed out raw; callers
 * only reach it inside the `query` lambda.
 */
export interface TaskQueries {
  readonly tasks: typeof tasks;
  /** Run one read fn; a driver throw/rejection becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleTaskQueries implements TaskQueries {
  private readonly db: Db;
  readonly tasks = tasks;

  constructor(opts: { readonly db: Db }) {
    this.db = opts.db;
  }

  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() => fn(this.db)),
      (cause) => ({ type: "DatabaseUnavailable", cause }),
    );
  }
}

/**
 * Normalize a stored `success.artifacts` entry to its wire identity — the
 * artifact's POSIX path relative to the task's `artifact/` dir. New rows
 * already store this relative form, so it passes straight through. Rows
 * written before the switch to relative storage hold an absolute path; we
 * strip the `/<id>/artifact/` prefix (the id is a unique per-task segment,
 * an unambiguous anchor) to recover the same identity. A migration shim for
 * pre-existing rows, not a permanent transform.
 */
export function normalizeArtifactRel(entry: string, id: string): string {
  const posix = entry.replace(/\\/g, "/");
  const needle = `/${id}/${TASK_ARTIFACT_SUBDIR}/`;
  const idx = posix.indexOf(needle);
  return idx === -1 ? posix : posix.slice(idx + needle.length);
}

/**
 * Normalize a stored `TaskSuccess`'s `artifacts` to their relative wire
 * identity. New rows already store relative paths (no-op); pre-existing
 * absolute rows are converted, so consumers see one uniform shape.
 */
function relativizeArtifacts(success: TaskSuccess, id: string): TaskSuccess {
  if (success.artifacts === undefined) return success;
  return { ...success, artifacts: success.artifacts.map((a) => normalizeArtifactRel(a, id)) };
}

/**
 * Read-side projection: map a stored row straight to the wire task view.
 * Unlike the domain's `TaskEntity.rehydrate` (write path), this does NOT
 * validate field shapes — the read model trusts rows our own mapper wrote and
 * only re-inflates JSON columns + folds the promoted `runtime` column back
 * into the metadata bag. Call it inside a `query` lambda so a JSON.parse throw
 * on a genuinely corrupt row surfaces as `DatabaseUnavailable`.
 */
export function projectTaskRow(row: TaskRow) {
  const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  if (row.runtime !== null) metadata.runtime = row.runtime;
  return {
    id: row.id as TaskId,
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
    ...(row.success !== null
      ? { success: relativizeArtifacts(JSON.parse(row.success) as TaskSuccess, row.id) }
      : {}),
    ...(row.failure !== null ? { failure: JSON.parse(row.failure) as TaskFailure } : {}),
    ...(row.cancellation !== null
      ? { cancellation: JSON.parse(row.cancellation) as TaskCancellation }
      : {}),
  };
}

/** Read a projected metadata value as a non-empty string, or `undefined`. */
export function metaString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
