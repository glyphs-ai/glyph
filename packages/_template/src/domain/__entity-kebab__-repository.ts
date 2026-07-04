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
 * Persistence port for the __Entity__ aggregate. Reads return
 * {@link __Entity__Entity}; row shapes stay inside infrastructure.
 * Error unions are inlined per signature (no per-op alias). `findById`
 * treats absence as `undefined`; `get` asserts existence with
 * `__Entity__NotFound`.
 */
export interface __Entity__Repository {
  get(id: __Entity__Id): ResultAsync<__Entity__Entity, __Entity__NotFound | DatabaseUnavailable>;
  findById(id: __Entity__Id): ResultAsync<__Entity__Entity | undefined, DatabaseUnavailable>;
  list(): ResultAsync<__Entity__Entity[], DatabaseUnavailable>;
  insert(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable>;
  save(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable>;
  delete(id: __Entity__Id): ResultAsync<void, DatabaseUnavailable>;
}
