import type { ResultAsync } from "neverthrow";
import type { SessionEntity } from "./session-entity.js";
import type { SessionId } from "./session-id.js";

/**
 * Registry error atoms — discriminated-union values flowing through
 * `Result`, not thrown exceptions. `SessionNotFound` is a normal
 * business outcome (id resolves to zero rows), distinct from
 * `DatabaseUnavailable` (the IO layer faulted).
 */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type SessionNotFound = {
  readonly type: "SessionNotFound";
  readonly id: SessionId;
};

export type SessionIdConflict = {
  readonly type: "SessionIdConflict";
  readonly id: SessionId;
};

export interface FindAllSessionsFilter {
  readonly createdSince?: string;
  readonly agent?: string;
}

/**
 * Persistence port for the session aggregate. Reads return
 * {@link SessionEntity}; row shapes stay inside infrastructure. Error
 * unions are inlined per signature (no per-op alias); `findById` treats
 * absence as `undefined`, `get` asserts existence.
 */
export interface SessionRepository {
  get(id: SessionId): ResultAsync<SessionEntity, SessionNotFound | DatabaseUnavailable>;
  findById(id: SessionId): ResultAsync<SessionEntity | undefined, DatabaseUnavailable>;
  findAll(filter: FindAllSessionsFilter): ResultAsync<SessionEntity[], DatabaseUnavailable>;
  insert(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable | SessionIdConflict>;
  save(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: SessionId): ResultAsync<void, DatabaseUnavailable>;
}
