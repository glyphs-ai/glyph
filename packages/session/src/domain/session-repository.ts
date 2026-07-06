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

/**
 * Write-side persistence port for the session aggregate. Pure reads
 * live on the read-side {@link SessionQueries}, which exposes the table
 * for read use-cases to compose their own SELECTs. `get` loads the
 * aggregate for mutation (asserting existence); `save` is an upsert
 * keyed on the repository's change-tracker (a freshly `create()`d
 * aggregate INSERTs; a loaded one UPDATEs).
 */
export interface SessionRepository {
  get(id: SessionId): ResultAsync<SessionEntity, SessionNotFound | DatabaseUnavailable>;
  save(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: SessionId): ResultAsync<void, DatabaseUnavailable>;
}
