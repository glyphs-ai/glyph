/**
 * Public surface of `@glyphs-ai/sdk`.
 *
 * Everything under `./generated/` is emitted by `@hey-api/openapi-ts`
 * (see `openapi-ts.config.ts` + `scripts/generate.ts`) and committed; the
 * only hand-written code is the `unwrap` / `GlyphError` ergonomics layered
 * on top. The package has zero runtime dependencies — the generated fetch
 * client is inlined — so it is safe to bundle for the browser.
 */

// Thin ergonomics layer we own: the normalised HTTP error type + guard.
export { GlyphError, type GlyphIssue, isGlyphError } from "./errors.js";

// The generated barrel omits the default client instance (it lives in
// `client.gen`); re-export it so consumers can point the SDK at a base
// URL, inject auth headers, or swap the `fetch` implementation via
// `client.setConfig({ ... })`.
export { client } from "./generated/client.gen.js";

// Generated operations (one tree-shakeable function per route, named
// `<method><PascalCasePath>`, e.g. `getApiHealth`) plus every request /
// response type.
export * from "./generated/index.js";

// Convenience namespace so `import { sdk }` resolves: `sdk.getApiHealth(...)`.
// Flat (one member per operation), not tag-grouped.
export * as sdk from "./generated/sdk.gen.js";

// Result helpers that turn a generated call's `{ data, error, response }`
// tuple into a payload or a thrown `GlyphError`.
export { unwrap, unwrapOr } from "./unwrap.js";
