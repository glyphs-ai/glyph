/**
 * Barrel for the transport-agnostic zod wire schemas.
 *
 * Each schema is the single source of truth for its wire shape: the
 * OpenAPI projection in `@glyphs-ai/server` and the inferred TS types
 * (`z.infer`, re-exported alongside each schema) both derive from it.
 */
export * from "./catalog.js";
