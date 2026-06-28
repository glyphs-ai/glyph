/**
 * Public API of `@glyphs-ai/__PKG__`.
 *
 * The main entry exports the service + composition root. Wire schemas,
 * inferred DTO types, and error classes live behind the `./contract`
 * subpath (`@glyphs-ai/__PKG__/contract`) so HTTP/CLI adapters import
 * the declaration surface without pulling in the service runtime.
 *
 * Construction: call `compose__Entity__Module({ dbFile })` once at the
 * composition root; never instantiate the service directly outside of
 * tests. Persistence internals (`tables.ts` `*Row` types, the drizzle
 * table object, `openDb`) are intentionally NOT re-exported — external
 * consumers go through the DTO + service surface. See
 * `docs/pkg-template.md` "Repository contract" for the rationale.
 */

export {
  type __Entity__Module,
  type __Entity__ModuleOptions,
  compose__Entity__Module,
} from "./__entity-kebab__.compose.js";
export {
  __Entity__Service,
  type __Entity__ServiceOpts,
} from "./application/__entity-kebab__.service.js";
