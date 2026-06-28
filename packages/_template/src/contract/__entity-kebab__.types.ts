/**
 * Public types for `@glyphs-ai/__PKG__`, inferred from the zod schemas
 * in `./__entity-kebab__.schemas.ts` (single source of truth) plus the
 * read-filter option shapes the service accepts.
 *
 * Exported via the `./contract` barrel. Service / repository / entity /
 * tables / compose files must NOT export interfaces or type aliases that
 * consumers use — those live here. (See `docs/pkg-template.md` "Where
 * DTOs live".)
 */
import type { z } from "zod";
import type {
  __Entity__Schema,
  Create__Entity__RequestSchema,
} from "./__entity-kebab__.schemas.js";

/** Wire-shape DTO returned by `__Entity__Service` reads. */
export type __Entity__ = z.infer<typeof __Entity__Schema>;

/** Input accepted by `__Entity__Service.create` (and a POST route, if any). */
export type Create__Entity__Request = z.infer<typeof Create__Entity__RequestSchema>;

/** Filter options accepted by `__Entity__Service.list` (a read; no wire body). */
export interface List__Entity__Opts {
  readonly nameStartsWith?: string;
}
