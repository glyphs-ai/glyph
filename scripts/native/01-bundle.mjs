/**
 * Build the CJS bundle the SEA blob wraps. Distinct from the existing
 * `bundle/glyph.js` (an ESM single-file output for the npm channel):
 * SEA requires CJS per the Node single-executable-applications doc.
 *
 * Pipeline parity with `pnpm bundle`:
 *   - same entry (`packages/cli/src/bin.ts`)
 *   - same workspace-level dashboard build (so the SPA exists in
 *     `packages/dashboard/dist/`; the SEA path never copies it, only
 *     the npm path does, but having the build run keeps the two
 *     channels honest about dashboard-side breakage)
 *   - same migration codegen (`scripts/inline-migrations.mjs`)
 *   - same externals as the npm bundle PLUS an inlined SEA bootstrap
 *     banner that materialises the vendored externals at startup
 *
 * Externals are kept identical to `esbuild.config.js` so the npm
 * bundle's runtime expectations match the SEA bundle's: every
 * externalised package is also vendored as a SEA asset and shows up
 * in the materialised `node_modules/` at runtime, so the same
 * `require("pino")` call resolves both ways.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import esbuild from "esbuild";

import { fail, isEntry } from "./exec.mjs";
import {
  nativeIntermediatesDir,
  nativeJsBundlePath,
  repoRoot,
  targetTriple,
} from "./paths.mjs";

const EXTERNAL = [
  // Same set as `esbuild.config.js`. The SEA bootstrap materialises
  // each of these into the runtime `node_modules/` so the bundle's
  // `require()` calls resolve identically to the npm channel.
  "pino",
  "pino-pretty",
  "pino-roll",
  "thread-stream",
  "better-sqlite3",
  "bindings",
  "@github/copilot-sdk",
];

const BOOTSTRAP_PATH = resolve(import.meta.dirname, "sea-bootstrap.cjs");

async function ensurePreflightsRun() {
  const target = targetTriple();
  if (target !== "linux-x64") {
    fail(
      `Native build targets ${target} but PR1 only supports linux-x64. ` +
        `Run on a linux-x64 host (or in CI's ubuntu-latest runner). ` +
        `Set GLYPH_NATIVE_TARGET=linux-x64 to override the detection if you ` +
        `know what you are doing.`,
    );
  }
  // Sanity-check the dashboard and workspace builds the npm bundle
  // already depends on. We invoke the existing scripts via `pnpm`
  // so this stays a single source of truth for what "bundle pipeline"
  // means; the SEA path is purely additive.
  console.log("==> pnpm build (workspace tsc -b)");
  execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit", shell: true });
  console.log("==> pnpm --filter @glyphs-ai/dashboard build");
  execFileSync(
    "pnpm",
    ["--filter", "@glyphs-ai/dashboard", "build"],
    { cwd: repoRoot, stdio: "inherit", shell: true },
  );
  console.log("==> inline migrations");
  execFileSync(
    "node",
    [resolve(repoRoot, "scripts/inline-migrations.mjs")],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

export async function runBundleStep() {
  await ensurePreflightsRun();

  await mkdir(nativeIntermediatesDir(), { recursive: true });
  const bootstrapSrc = await readFile(BOOTSTRAP_PATH, "utf-8");
  const out = nativeJsBundlePath();
  await mkdir(dirname(out), { recursive: true });

  console.log(`==> esbuild → ${out}`);
  const result = await esbuild.build({
    entryPoints: { main: resolve(repoRoot, "packages/cli/src/bin.ts") },
    outdir: nativeIntermediatesDir(),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: EXTERNAL,
    banner: {
      // Run the SEA bootstrap BEFORE esbuild's CJS prelude touches
      // any user code. Bootstrap is a no-op outside SEA so the
      // bundle stays runnable as a plain Node script (handy for
      // local debugging the build output).
      js: bootstrapSrc,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    logLevel: "info",
  });

  if (result.errors.length > 0) {
    fail(`esbuild reported ${result.errors.length} errors`);
  }
  if (!existsSync(out)) {
    fail(`esbuild completed but ${out} is missing`);
  }
  const stat = await readFile(out);
  console.log(`==> bundle size: ${stat.length.toLocaleString()} bytes`);

  // Drop a stub package.json next to the bundle so any process that
  // tries to resolve the bundle as a package finds something sensible
  // (esbuild's "Output" entry is otherwise nameless). Cheap; helps
  // any post-mortem of intermediates.
  await writeFile(
    resolve(nativeIntermediatesDir(), "package.json"),
    `${JSON.stringify({ name: "glyph-sea-intermediate", private: true, type: "commonjs" }, null, 2)}\n`,
  );
}

if (isEntry(import.meta.url)) {
  await runBundleStep();
}
