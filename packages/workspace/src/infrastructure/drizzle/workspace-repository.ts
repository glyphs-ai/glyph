import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  WorkspaceIdConflict,
  WorkspaceNotFound,
  WorkspacePathConflict,
  WorkspaceRepository,
} from "../../domain/workspace-repository.js";
import type { Db } from "./workspace-db.js";
import { WorkspaceMapper, type WorkspaceRow } from "./workspace-mapper.js";
import { workspaces } from "./workspace-schema.js";

/**
 * Drizzle-backed write-side adapter for {@link WorkspaceRepository}.
 *
 * Change-tracking lives here, not on the entity: `get` snapshots the loaded
 * row into a `WeakMap` keyed on the returned entity; `save` looks the entity
 * up — absent ⇒ INSERT (a freshly `create()`d aggregate), present ⇒ diff the
 * current row against the snapshot and UPDATE only the changed columns (or
 * no-op). The `WeakMap` releases entries when the entity is garbage-collected,
 * so there is nothing to clean up per request.
 */
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  private readonly db: Db;
  private readonly snapshots = new WeakMap<WorkspaceEntity, WorkspaceRow>();

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: WorkspaceId): ResultAsync<WorkspaceEntity, WorkspaceNotFound | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.select().from(workspaces).where(eq(workspaces.id, id)).get(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).andThen((row) => {
      if (!row)
        return errAsync<WorkspaceEntity, WorkspaceNotFound>({ type: "WorkspaceNotFound", id });
      const entity = WorkspaceMapper.toDomain(row);
      this.snapshots.set(entity, WorkspaceMapper.toRow(entity));
      return okAsync(entity);
    });
  }

  save(
    entity: WorkspaceEntity,
  ): ResultAsync<void, DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict> {
    const snapshot = this.snapshots.get(entity);
    const current = WorkspaceMapper.toRow(entity);
    // Untracked entity ⇒ never loaded ⇒ INSERT (may hit a unique conflict).
    if (snapshot === undefined) {
      return ResultAsync.fromPromise(
        this.db.insert(workspaces).values(current).run(),
        (cause) => cause,
      )
        .map(() => this.track(entity, current))
        .orElse((cause) => this.translateInsertError(cause, entity));
    }
    // Tracked entity: UPDATE only the columns that diverged from the snapshot.
    const diff = diffRow(snapshot, current);
    if (Object.keys(diff).length === 0) return okAsync(undefined);
    return ResultAsync.fromPromise(
      this.db.update(workspaces).set(diff).where(eq(workspaces.id, entity.id)).run(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map(() => this.track(entity, current));
  }

  /** Record the persisted row as the entity's tracked snapshot. */
  private track(entity: WorkspaceEntity, row: WorkspaceRow): void {
    this.snapshots.set(entity, row);
  }

  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.delete(workspaces).where(eq(workspaces.id, id)).run(),
      DrizzleWorkspaceRepository.asDatabaseUnavailable,
    ).map(() => undefined);
  }

  /**
   * Translate SQLite constraint violations into typed domain errors.
   * libsql wraps the driver error, so we walk the cause chain for the
   * SQLite code + message. Pre-flight path checks are best-effort UX;
   * constraints are the race-free backstop.
   */
  private translateInsertError(
    cause: unknown,
    entity: WorkspaceEntity,
  ): ResultAsync<never, DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict> {
    const { code, message } = extractSqliteError(cause);
    if (code.startsWith("SQLITE_CONSTRAINT")) {
      if (message.includes("workspaces.id") || code.endsWith("PRIMARYKEY")) {
        return errAsync<never, WorkspaceIdConflict>({ type: "WorkspaceIdConflict", id: entity.id });
      }
      if (message.includes("workspaces.workspace_dir")) {
        // Best-effort async lookup of the colliding workspace id.
        return ResultAsync.fromPromise(
          this.db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.workspaceDir, entity.workspaceDir))
            .get(),
          () => undefined,
        )
          .orElse(() => okAsync(undefined))
          .andThen((existing) =>
            errAsync<never, WorkspacePathConflict>({
              type: "WorkspacePathConflict",
              workspaceDir: entity.workspaceDir,
              existingId: existing ? (existing.id as WorkspaceId) : undefined,
            }),
          );
      }
    }
    return errAsync(DrizzleWorkspaceRepository.asDatabaseUnavailable(cause));
  }
}

/** Walk an error's cause chain, collecting the SQLite code + longest message. */
function extractSqliteError(cause: unknown): { code: string; message: string } {
  let code = "";
  let message = "";
  let cur: unknown = cause;
  const seen = new Set<unknown>();
  // Only capture the message from links that carry a SQLite code. libsql wraps
  // the driver error in a DrizzleQueryError whose message is the query text +
  // params — that would shadow the real "constraint failed: <table>.<column>"
  // message we key on.
  while (cur !== null && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "string" && c.code.startsWith("SQLITE_")) {
      code = c.code;
      if (typeof c.message === "string") message = c.message;
    }
    cur = c.cause;
  }
  return { code, message };
}

/**
 * Shallow column-wise diff of two rows: the subset of `current`'s columns
 * whose value differs from `snapshot`. All workspace columns are primitives
 * (string | null), so identity comparison is exact.
 */
function diffRow(snapshot: WorkspaceRow, current: WorkspaceRow): Partial<WorkspaceRow> {
  const diff: Partial<WorkspaceRow> = {};
  for (const key of Object.keys(current) as (keyof WorkspaceRow)[]) {
    if (current[key] !== snapshot[key]) {
      diff[key] = current[key] as WorkspaceRow[keyof WorkspaceRow] as never;
    }
  }
  return diff;
}
