/** Public value objects and errors shared across __Entity__ use-cases. */

export type { __Entity__AlreadyArchived } from "../domain/__entity-kebab__-entity.js";
export { type __Entity__Id, __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
export { type __Entity__Name, __Entity__NameSchema } from "../domain/__entity-kebab__-name.js";
export type {
  __Entity__NotFound,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";

import type { __Entity__AlreadyArchived } from "../domain/__entity-kebab__-entity.js";
import type {
  __Entity__NotFound,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";

/** Closed union of every error a __Entity__ use-case can yield. */
export type __Entity__Error = __Entity__AlreadyArchived | __Entity__NotFound | DatabaseUnavailable;
