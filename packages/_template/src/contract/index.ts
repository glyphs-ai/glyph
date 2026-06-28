/**
 * Public `./contract` surface of `@glyphs-ai/__PKG__`: the zod wire
 * schemas, their inferred types, and the public error classes. Plain zod
 * only — no DB handles, no service classes, no projection logic (that
 * lives in application). Imported by HTTP/CLI adapters that need the
 * declaration surface without the service runtime.
 */
export * from "./__entity-kebab__.errors.js";
export * from "./__entity-kebab__.schemas.js";
export * from "./__entity-kebab__.types.js";
