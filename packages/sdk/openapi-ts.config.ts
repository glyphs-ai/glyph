import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Codegen config for the glyph SDK.
 *
 * `input` is overridden at runtime by `scripts/generate.ts` (it points
 * the generator at a temp file holding the freshly-assembled spec), so
 * the value here is only a placeholder for ad-hoc `openapi-ts` CLI runs.
 *
 * Plugins are kept deliberately minimal — the three that produce a typed
 * fetch client and nothing else:
 *   - `@hey-api/client-fetch`  → the runtime-agnostic fetch client, emitted
 *     INLINE into `src/generated/` (openapi-ts >= 0.73 bundles the client
 *     source rather than importing the npm package). The output has zero
 *     bare/`node:` imports, so the SDK ships with no runtime dependencies
 *     and is safe for the dashboard browser bundle.
 *   - `@hey-api/typescript`    → request/response/`components` types.
 *   - `@hey-api/sdk`           → one tree-shakeable function per operation.
 *
 * Output is committed under `src/generated/` and drift-checked in CI.
 * The generator is deterministic for a fixed input spec (stable file
 * ordering, no timestamps), so repeated runs are byte-identical.
 */
export default defineConfig({
  input: "./openapi.json",
  output: {
    path: "./src/generated",
    // No post-processing: the committed files are excluded from Biome, and
    // shelling out to a formatter/linter would couple byte-stability to a
    // formatter version. `postProcess: []` supersedes the deprecated
    // `format`/`lint` flags.
    postProcess: [],
    // Stable, self-contained barrel + per-operation files.
    indexFile: true,
  },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});
