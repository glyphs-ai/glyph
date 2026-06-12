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
import { dirname, relative, resolve } from "node:path";
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

  // The real CLI entry (`packages/cli/src/bin.ts`) uses top-level
  // await, which is not legal in CJS — and SEA requires CJS. We
  // can't modify packages/, so we write a thin synthetic entry next
  // to `main.cjs` that wraps the call in a `.then(...).catch(...)`.
  // The wrapper has zero behaviour beyond what bin.ts does (await
  // run(argv) then exit with its code); it only changes the JS
  // surface so esbuild can emit CJS.
  const entrySrcPath = resolve(nativeIntermediatesDir(), "entry.cjs.ts");
  const cliIndexPath = resolve(repoRoot, "packages/cli/src/index.ts");
  const cliIndexRel = relative(nativeIntermediatesDir(), cliIndexPath).replaceAll("\\", "/");
  await writeFile(
    entrySrcPath,
    `import { run } from "${cliIndexRel}";\n` +
      "run(process.argv)\n" +
      "  .then((code) => { process.exit(code); })\n" +
      "  .catch((err) => { console.error(err); process.exit(1); });\n",
  );

  // CJS `import.meta` polyfills. esbuild emits warnings for every
  // `import.meta.{url,dirname,filename,resolve}` site when targeting
  // CJS because the spec leaves them undefined; we replace each one
  // with a reference to a banner-defined constant or helper so
  // runtime semantics match the ESM build.
  //
  // `import.meta.resolve(spec)`: at runtime the bundle's CJS `require`
  // walks `Module.globalPaths`, which the SEA bootstrap unshifts the
  // materialised `node_modules/` into. So `require.resolve(spec)`
  // sees every vendored package the same way an ESM `import.meta.
  // resolve(spec)` would.
  const cjsImportMetaShim =
    "const __glyph_url_mod = require('node:url');\n" +
    "const __glyph_meta_url = __glyph_url_mod.pathToFileURL(__filename).href;\n" +
    "const __glyph_meta_filename = __filename;\n" +
    "const __glyph_meta_dirname = __dirname;\n" +
    "const __glyph_meta_resolve = (spec) => __glyph_url_mod.pathToFileURL(require.resolve(spec)).href;\n";

  console.log(`==> esbuild → ${out}`);
  const result = await esbuild.build({
    entryPoints: [entrySrcPath],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: EXTERNAL,
    banner: {
      // Bootstrap MUST run before any user code; the import-meta
      // shim consts come second so user code that references them
      // (post-esbuild rewrite) finds them in scope.
      js: bootstrapSrc + "\n" + cjsImportMetaShim,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.url": "__glyph_meta_url",
      "import.meta.filename": "__glyph_meta_filename",
      "import.meta.dirname": "__glyph_meta_dirname",
      "import.meta.resolve": "__glyph_meta_resolve",
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
