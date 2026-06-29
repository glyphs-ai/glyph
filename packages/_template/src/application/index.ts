/**
 * Application barrel for the domain symbols that cross the package
 * boundary: the branded id value object and the error atoms referenced
 * by use-case error unions. Entity, repository, schema, mapper, and row
 * types stay package-internal.
 */

export type { __Entity__AlreadyArchived } from "../domain/__entity-kebab__-entity.js";
export { type __Entity__Id, __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
export type {
  __Entity__IdConflict,
  __Entity__NotFound,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";
