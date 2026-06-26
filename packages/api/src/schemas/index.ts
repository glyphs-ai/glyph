/**
 * Barrel for the transport-agnostic zod wire schemas.
 *
 * Each schema mirrors a wire DTO exported from the api `wire/` surface
 * and is the single source of truth for the OpenAPI projection in
 * `@glyphs-ai/server`. Bidirectional `z.infer` ↔ interface parity is
 * pinned by `packages/api/test/wire-schema-parity.test.ts`.
 */
export * from "./catalog.js";
export * from "./health.js";
export * from "./runtimes.js";
export * from "./schedules.js";
export * from "./server-config.js";
export * from "./sessions.js";
export * from "./tasks.js";
export * from "./workflows.js";
export * from "./workspaces.js";
