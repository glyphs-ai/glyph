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

export type WorkspaceNotRegistered = {
  readonly type: "WorkspaceNotRegistered";
  readonly id: WorkspaceId;
};

/**
 * Persistence port for the workspace registry. Reads return
 * {@link WorkspaceEntity}; row shapes stay inside infrastructure.
 * Methods return `ResultAsync` and adapters map driver failures to
 * `DatabaseUnavailable`.
 */
export interface WorkspaceRepository {
  findById(id: WorkspaceId): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findByPath(workspaceDir: string): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findAllByLastOpened(): ResultAsync<WorkspaceEntity[], DatabaseUnavailable>;
  findLastOpened(): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findLastOpenedId(): ResultAsync<WorkspaceId | undefined, DatabaseUnavailable>;
  insert(
    entity: WorkspaceEntity,
  ): ResultAsync<void, DatabaseUnavailable | WorkspaceIdConflict | WorkspacePathConflict>;
  save(entity: WorkspaceEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable>;
}
