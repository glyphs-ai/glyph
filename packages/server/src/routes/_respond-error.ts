/**
 * Re-export the centralised error response utilities from `@glyphs-ai/api`.
 * Server route modules import from this file — the indirection lets the
 * canonical implementation live in api (the lower tier) while keeping every
 * other server route file's import path unchanged.
 */
export { type ErrorPolicy, type RespondErrorOpts, respondError } from "@glyphs-ai/api";
