/**
 * Registry of npm packages that have to ride inside the SEA blob as
 * embedded assets instead of being inlined into the esbuild CJS bundle.
 *
 * Three categories of "won't inline":
 *
 *   1. Native bindings. `better-sqlite3` loads its `.node` binary via
 *      the `bindings` package, which walks the filesystem from the
 *      calling module's `__dirname` looking for `build/Release/*.node`.
 *      Inlining the JS shim relocates `__dirname` to the SEA snapshot
 *      path and the lookup fails. Vendor both packages and let the
 *      bootstrap materialise them into a real `node_modules/` so
 *      `bindings`'s walk has somewhere to land.
 *
 *   2. Workers loaded by path. `pino` constructs its transport
 *      destinations (`pino-pretty`, `pino-roll`) inside a
 *      `worker_threads.Worker` whose path string comes from
 *      `thread-stream` using its own `__dirname`. Same fix as (1):
 *      materialise the whole pino dependency closure so each worker's
 *      `__dirname` is a real directory.
 *
 *   3. Runtime resolvers that walk a sibling package. The Copilot SDK
 *      calls `import.meta.resolve('@github/copilot/sdk')` and the
 *      server's `assertCopilotSdkResolvable` preflight uses
 *      `createRequire(sdkUrl).resolve('@github/copilot/sdk')` to
 *      probe the CLI's package.json `exports` map. Both expect
 *      `@github/copilot` and `@github/copilot-sdk` to be present in a
 *      `node_modules/` reachable from the SDK module. We vendor the
 *      SDK in full plus the CLI's manifest (just `package.json`) so
 *      the preflight passes — see `BUNDLE_ONLY_PACKAGE_JSON` below.
 *
 * The collector in `assets.mjs` walks each entry's transitive
 * `dependencies` (from package.json) to materialise the closure. PR1
 * targets linux-x64 only, so platform-specific subpackages (better-
 * sqlite3's prebuild, etc.) collapse to a single set; PR2 expands the
 * matrix and turns these names into per-target tables.
 */

export const SUPPORTED_TARGETS = Object.freeze(["linux-x64"]);

export function isSupportedTarget(target) {
  return SUPPORTED_TARGETS.includes(target);
}

/**
 * Roots to vendor. The collector enumerates each root's
 * `dependencies` recursively, so transitive peers (e.g.
 * `thread-stream`, `vscode-jsonrpc`) don't need explicit listing.
 *
 * `bundleOnlyPackageJson: true` skips collecting code files and ships
 * only `package.json`. This is used for `@github/copilot`, whose full
 * install is ~270 MB and unnecessary for PR1: the server's preflight
 * only needs the manifest to be readable so Node's exports-resolver
 * sees the ESM-only `./sdk` subpath and throws the expected
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. The full CLI ships in PR2 alongside
 * the multi-target packaging story.
 */
export const NATIVE_ROOTS = Object.freeze([
  { name: "better-sqlite3" },
  { name: "bindings" },
  { name: "pino" },
  { name: "pino-pretty" },
  { name: "pino-roll" },
  { name: "@github/copilot-sdk" },
  { name: "@github/copilot", bundleOnlyPackageJson: true },
]);
