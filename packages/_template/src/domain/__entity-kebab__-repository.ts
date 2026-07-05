import type { ResultAsync } from "neverthrow";
import type { __Entity__Entity } from "./__entity-kebab__-entity.js";
import type { __Entity__Id } from "./__entity-kebab__-id.js";

/**
 * Repository errors are discriminated-union values flowing through
 * `Result`, not thrown exceptions.
 */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type __Entity__NotFound = {
  readonly type: "__Entity__NotFound";
  readonly id: __Entity__Id;
};

/**
 * Write-side persistence port for the __Entity__ aggregate. Repositories expose
 * only the basic write-side triad: `get` asserts aggregate existence for a
 * mutation, `save` persists both new and changed aggregates, and `delete`
 * removes an aggregate. Flexible read use-cases go through the query seam in
 * infrastructure/drizzle instead of expanding this port.
 */
export interface __Entity__Repository {
  get(id: __Entity__Id): ResultAsync<__Entity__Entity, __Entity__NotFound | DatabaseUnavailable>;
  save(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: __Entity__Id): ResultAsync<void, DatabaseUnavailable>;
}
