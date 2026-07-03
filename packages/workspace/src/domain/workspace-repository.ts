import type { ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "./workspace-entity.js";
import type { WorkspaceId } from "./workspace-id.js";

/**
 * Registry errors. They are discriminated-union values flowing through
 * `Result`, not thrown exceptions.
 */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type WorkspaceIdConflict = {
  readonly type: "WorkspaceIdConflict";
  readonly id: WorkspaceId;
};

export type WorkspacePathConflict = {
  readonly type: "WorkspacePathConflict";
  readonly workspaceDir: string;
  /**
   * The id of the workspace already registered at this path. May be
   * absent in the rare case the adapter cannot look it up (e.g. a
   * concurrent unregister deleted the row between the constraint
   * trigger and the lookup).
   */
  readonly existingId: WorkspaceId | undefined;
};

/**
 * "The row is absent" outcome for {@link WorkspaceRepository.get}. A
 * use-case decides how to interpret a missing row: open/rename surface it
 * directly as the caller-facing error; unregister treats it as idempotent
 * success.
 */
export type WorkspaceNotFound = {
  readonly type: "WorkspaceNotFound";
  readonly id: WorkspaceId;
};

/**
 * Persistence port for the mutable workspace aggregate. Reads return
 * {@link WorkspaceEntity}; row shapes stay inside infrastructure. Methods
 * return `ResultAsync` and adapters map driver failures to
 * `DatabaseUnavailable`.
 *
 * Write-side only — pure reads (list, last-opened, path lookup) live on
 * the read-side `WorkspaceQueries`. `save` is an upsert keyed on the
 * entity's snapshot: a freshly `create()`d aggregate (null snapshot) is
 * INSERTed and may surface the unique-constraint conflicts; a loaded
 * aggregate is UPDATEd (mutable columns only) and cannot conflict.
 */
export interface WorkspaceRepository {
  /** Load the aggregate for mutation; captures a snapshot for save-time diffing. */
  get(id: WorkspaceId): ResultAsync<WorkspaceEntity, WorkspaceNotFound | DatabaseUnavailable>;

  /**
   * Persist the aggregate. New (null-snapshot) entities INSERT — surfacing
   * `WorkspaceIdConflict` / `WorkspacePathConflict` from the unique
   * constraints; loaded entities UPDATE only the mutable columns (or no-op
   * when nothing diverged), which cannot conflict.
   */
  save(
    entity: WorkspaceEntity,
  ): ResultAsync<void, DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict>;

  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable>;
}
