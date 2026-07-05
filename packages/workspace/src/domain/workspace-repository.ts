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
 * INSERTed; a loaded aggregate is UPDATEd (mutable columns only).
 */
export interface WorkspaceRepository {
  /** Load the aggregate for mutation; captures a snapshot for save-time diffing. */
  get(id: WorkspaceId): ResultAsync<WorkspaceEntity, WorkspaceNotFound | DatabaseUnavailable>;

  /**
   * Persist the aggregate. New (null-snapshot) entities INSERT; loaded
   * entities UPDATE only the mutable columns (or no-op when nothing diverged).
   */
  save(entity: WorkspaceEntity): ResultAsync<void, DatabaseUnavailable>;

  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable>;
}
