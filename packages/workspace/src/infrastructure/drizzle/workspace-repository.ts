import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  WorkspaceNotFound,
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

  save(entity: WorkspaceEntity): ResultAsync<void, DatabaseUnavailable> {
    const snapshot = this.snapshots.get(entity);
    const current = WorkspaceMapper.toRow(entity);
    // Untracked entity ⇒ never loaded ⇒ INSERT (may hit a unique conflict).
    if (snapshot === undefined) {
      return ResultAsync.fromPromise(
        this.db.insert(workspaces).values(current).run(),
        DrizzleWorkspaceRepository.asDatabaseUnavailable,
      ).map(() => this.track(entity, current));
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
