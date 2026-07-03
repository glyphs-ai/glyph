/**
 * Public wire surface of `@glyphs-ai/api` (the `./wire` subtree).
 *
 * Pure wire DTO types. No
 * orchestration, no DB handles, no subprocess spawning. The api barrel
 * re-exports this subtree; the SPA and CLI consume the same shapes
 * through the generated `@glyphs-ai/sdk`.
 *
 * Re-exports are grouped by source file rather than by category so the
 * "where does `Foo` live?" answer is one `grep` away. The cross-pkg
 * re-exports in `./domain.ts` cover the domain types that cross the
 * wire (`Agent`, `Skill`, `Schedule`, etc.) so consumers never need
 * a workspace dep on the source pkg.
 */

export * from "./domain.js";
export * from "./plan-to-manifest.js";
export * from "./schedules.js";
export * from "./workflows.js";
