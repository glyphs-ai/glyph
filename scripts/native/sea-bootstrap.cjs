/**
 * SEA bootstrap. Runs as the first executable code in the
 * `dist-native/intermediates/main.cjs` bundle (esbuild injects this
 * file as a `banner.js`).
 *
 * Two responsibilities:
 *
 *   1. Materialise every vendored package (the closure described in
 *      `scripts/native/native-deps.mjs`) plus glyph's own
 *      `package.json` into a deterministic temp directory, then
 *      teach Node's module resolver to look there. This is what
 *      makes `require("better-sqlite3")`, `require("pino")`, the
 *      `bindings` resolver's filesystem walk, and pino's worker-
 *      thread `Worker(path)` calls all find what they expect.
 *
 *   2. Patch `fs.readFileSync` / `fs.promises.readFile` so the CLI's
 *      version reader (which probes
 *      `<execpath-dir>/(../)*package.json`) and the server's
 *      `readServerPackageMeta` lookup hit the materialised copy
 *      instead of returning the "0.0.0-unknown" placeholder.
 *
 * The bootstrap is a no-op outside SEA (the bundle can still run as a
 * regular Node script during local debugging or future tests), so
 * `require("node:sea")` failing or `sea.isSea()` returning false
 * short-circuits the whole block.
 */

(() => {
  let sea;
  try {
    sea = require("node:sea");
  } catch {
    return;
  }
  if (!sea.isSea()) return;

  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const Module = require("node:module");

  const MANIFEST_KEY_PREFIX = "native/";
  const PACKAGE_JSON_ASSET_KEY = "glyph/package.json";

  const triple = `${process.platform}-${process.arch}`;
  const manifestKey = `${MANIFEST_KEY_PREFIX}${triple}/manifest.json`;

  let manifest;
  try {
    const manifestBuf = sea.getRawAsset(manifestKey);
    manifest = JSON.parse(Buffer.from(manifestBuf).toString("utf-8"));
  } catch (err) {
    process.stderr.write(
      `[glyph-sea] cannot read embedded manifest at ${manifestKey}: ${err && err.message ? err.message : err}\n`,
    );
    process.exit(1);
  }

  const baseTmp = process.env.GLYPH_SEA_HOME
    ? process.env.GLYPH_SEA_HOME
    : path.join(os.tmpdir(), "glyph-sea");
  const materializeRoot = path.join(baseTmp, `${manifest.target}-${manifest.contentHash}`);
  const nodeModulesDir = path.join(materializeRoot, "node_modules");
  const glyphPackageJsonDest = path.join(materializeRoot, "package.json");
  const sentinel = path.join(materializeRoot, ".materialized");

  if (!fs.existsSync(sentinel)) {
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    for (const pkg of manifest.packages) {
      for (const file of pkg.files) {
        const dest = path.join(materializeRoot, file.relativePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const buf = sea.getRawAsset(file.assetKey);
        fs.writeFileSync(dest, Buffer.from(buf));
      }
    }
    const glyphPkgKey = (manifest.glyphPackageJson && manifest.glyphPackageJson.assetKey)
      || PACKAGE_JSON_ASSET_KEY;
    const glyphPkgBuf = sea.getRawAsset(glyphPkgKey);
    fs.writeFileSync(glyphPackageJsonDest, Buffer.from(glyphPkgBuf));
    fs.writeFileSync(sentinel, manifest.contentHash);
  }

  // Teach Node's resolver about the materialised tree. NODE_PATH +
  // `Module._initPaths()` covers `require()` from the bundle and from
  // every materialised module loaded subsequently (workers included —
  // worker threads inherit the parent's env). `Module.globalPaths`
  // is the post-init store; we prepend to it directly as a
  // belt-and-suspenders for the rare case where `_initPaths` is
  // unavailable in a future Node release.
  process.env.NODE_PATH = nodeModulesDir
    + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
  if (typeof Module._initPaths === "function") {
    Module._initPaths();
  }
  if (Array.isArray(Module.globalPaths) && !Module.globalPaths.includes(nodeModulesDir)) {
    Module.globalPaths.unshift(nodeModulesDir);
  }

  // Read-intercept so `<execpath-dir>/(../)*package.json` reads land
  // on the embedded copy. Three candidate paths cover both layouts
  // the CLI version reader probes (one for the bundle layout, one
  // for the source layout) plus the server's resolver.
  const execDir = path.dirname(process.execPath);
  const candidatePaths = new Set([
    path.normalize(path.join(execDir, "package.json")),
    path.normalize(path.join(execDir, "..", "package.json")),
    path.normalize(path.join(execDir, "..", "..", "package.json")),
  ]);

  const origReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(p, ...rest) {
    if (typeof p === "string" && candidatePaths.has(path.normalize(p))) {
      return origReadFileSync(glyphPackageJsonDest, ...rest);
    }
    return origReadFileSync(p, ...rest);
  };
  const fsPromises = require("node:fs/promises");
  const origReadFile = fsPromises.readFile;
  fsPromises.readFile = function patchedReadFile(p, ...rest) {
    if (typeof p === "string" && candidatePaths.has(path.normalize(p))) {
      return origReadFile(glyphPackageJsonDest, ...rest);
    }
    return origReadFile(p, ...rest);
  };
})();
