import type { ResultAsync } from "neverthrow";
import type { WorkspaceEntity } from "./workspace-entity.js";
import type { WorkspaceId } from "./workspace-id.js";

/**
 * Errors produced by — or constructed from — the workspace registry
 * port. Co-located with the port because each variant's meaning
 * belongs to "the registry":
 *
 *   - `DatabaseUnavailable`  — driver-level fault (Drizzle / SQLite)
 *   - `WorkspaceIdConflict`  — `insert` UNIQUE / PK violation on `id`
 *   - `WorkspacePathConflict` — `insert` UNIQUE violation on
 *                                `workspaceDir`
 *   - `WorkspaceNotRegistered` — use-cases build this when
 *                                 `findById` resolves `undefined`;
 *                                 the registry is the source of
 *                                 truth for presence.
 *
 * Discriminated-union values, NOT classes. `switch (err.type)`
 * narrows exhaustively. Plain value semantics: these are values
 * flowing through `Result`, never thrown.
 *
 * Distinct from `workspace-entity.ts`, which owns errors the entity
 * raises FROM ITS OWN STATE (e.g. "can't rename an archived
 * workspace"). The registry errors here all need information the
 * entity does not have (the rest of the table; absence of a row).
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
 * Error variants {@link WorkspaceRepository.insert} may yield. The
 * two constraint violations (`WorkspaceIdConflict`,
 * `WorkspacePathConflict`) are the racy-write backstop for the
 * application's pre-flight `findByPath` check — the adapter
 * translates SQLite constraint codes to these typed values so the
 * use-case can `match` on them without inspecting SQL state.
 */
export type InsertWorkspaceError =
  | DatabaseUnavailable
  | WorkspaceIdConflict
  | WorkspacePathConflict;

/**
 * Persistence port for the workspace registry. Domain-owned interface
 * the application depends on; concrete adapters (Drizzle, in-memory
 * for tests) live in `infrastructure/`.
 *
 * Reads return the pkg-owned {@link WorkspaceEntity} (a class
 * instance, rehydrated via `WorkspaceMapper.toDomain`). The Drizzle
 * row shape never crosses this boundary.
 *
 * Write contract:
 *   - `insert(entity)` — for brand-new aggregates; may yield
 *     `WorkspaceIdConflict` / `WorkspacePathConflict` from UNIQUE /
 *     PRIMARY KEY violations.
 *   - `save(entity)` — persist mutations of an existing aggregate
 *     (rename, markOpened). Writes every column from the entity, so
 *     callers don't need to think about "which fields changed". No
 *     constraint variants because no mutable field is unique.
 *
 * Result/error contract: every method returns a `ResultAsync` —
 * adapters never throw. Driver-level failures collapse to
 * `DatabaseUnavailable`.
 */
export interface WorkspaceRepository {
  findById(id: WorkspaceId): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findByPath(workspaceDir: string): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findAllByLastOpened(): ResultAsync<WorkspaceEntity[], DatabaseUnavailable>;
  findLastOpened(): ResultAsync<WorkspaceEntity | undefined, DatabaseUnavailable>;
  findLastOpenedId(): ResultAsync<WorkspaceId | undefined, DatabaseUnavailable>;
  insert(entity: WorkspaceEntity): ResultAsync<void, InsertWorkspaceError>;
  save(entity: WorkspaceEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: WorkspaceId): ResultAsync<void, DatabaseUnavailable>;
}
