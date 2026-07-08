/**
 * Public API of `@glyphs-ai/__PKG__`: per-use-case wire contracts
 * (request/response schemas + error unions), shared value objects and
 * error atoms, and the `compose__Entity__Module` composition root.
 * Use-case classes and persistence internals stay package-private.
 */

export {
  type __Entity__Module,
  type __Entity__ModuleOptions,
  compose__Entity__Module,
} from "./__entity-kebab__-module.js";
export {
  type __Entity__AlreadyArchived,
  type __Entity__Error,
  type __Entity__Id,
  __Entity__IdSchema,
  type __Entity__Name,
  __Entity__NameSchema,
  type __Entity__NotFound,
  type DatabaseUnavailable,
} from "./application/__entity-kebab__-public.js";
export {
  type Archive__Entity__Error,
  type Archive__Entity__Request,
  Archive__Entity__RequestSchema,
  type Archive__Entity__Response,
  Archive__Entity__ResponseSchema,
} from "./application/archive-__entity-kebab__.js";
export {
  type Create__Entity__Error,
  type Create__Entity__Request,
  Create__Entity__RequestSchema,
  type Create__Entity__Response,
  Create__Entity__ResponseSchema,
} from "./application/create-__entity-kebab__.js";
export {
  type Get__Entity__Error,
  type Get__Entity__Request,
  Get__Entity__RequestSchema,
  type Get__Entity__Response,
  Get__Entity__ResponseSchema,
} from "./application/get-__entity-kebab__.js";
export {
  type List__Entity__sError,
  type List__Entity__sRequest,
  List__Entity__sRequestSchema,
  type List__Entity__sResponse,
  List__Entity__sResponseSchema,
} from "./application/list-__entity-kebab__s.js";
export type { Db } from "./infrastructure/drizzle/__entity-kebab__-db.js";
