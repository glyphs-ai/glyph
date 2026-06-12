/**
 * Collect every file we need to ship as a SEA asset and produce a
 * manifest the bootstrap can iterate at startup. The output is shaped
 * for `sea.getRawAsset()`: every file gets a stable asset key, every
 * package keeps its `node_modules/<name>/…` relative layout so the
 * materialised tree is byte-identical to what npm/pnpm would lay
 * down. That layout is the whole point — it's what makes the
 * runtime resolvers (`require`, `import.meta.resolve`, `bindings`)
 * find what they expect.
 *
 * Walking transitive dependencies happens here so `native-deps.mjs`
 * stays declarative (just the roots). The walk follows each
 * package's `package.json#dependencies` and accumulates a flat set of
 * install roots; the bootstrap then hoists all of them into one
 * `node_modules/` directory at the materialise root. We deliberately
 * skip `optionalDependencies` and `peerDependencies`: the install
 * tree present at build time already reflects the user's optional
 * choices (pnpm has decided which platform-specific prebuilds to
 * fetch), so any package present in the closure is one we need.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { NATIVE_ROOTS } from "./native-deps.mjs";

export const NATIVE_ASSET_MANIFEST_VERSION = 1;

/**
 * Asset key for the manifest itself. Bootstrap reads this first to
 * discover every other key. The key is namespaced under the target
 * triple so a fat binary (PR2) could one day ship multiple manifests.
 */
export function manifestAssetKey(target) {
  return `native/${target}/manifest.json`;
}

/**
 * Asset key for the embedded copy of glyph's root `package.json`.
 * Read by the bootstrap to back the read-intercept that satisfies
 * `<execpath-dir>/(../)*package.json` lookups from the CLI version
 * reader and the server's health-meta reader.
 */
export const PACKAGE_JSON_ASSET_KEY = "glyph/package.json";

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(root);
  return out;
}

/**
 * Resolve a package's install root on disk.
 *
 * We cannot rely on `createRequire(...).resolve(name)` because two of
 * the closure's packages — `@github/copilot-sdk` and `@github/copilot`
 * — expose ESM-only `exports` maps (no `require` condition). The CJS
 * resolver therefore throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even though
 * the package directory plainly exists on disk. For the asset collector
 * we only need the directory; we do not need Node's resolver to agree
 * with us. So we do a filesystem walk: from each candidate base
 * directory we look for `node_modules/<name>/package.json`, climbing
 * up parent dirs until we find one or run out of parents.
 *
 * Strategy order:
 *   1. Try CJS `require.resolve(<name>/package.json)` — wins for the
 *      well-behaved packages (better-sqlite3, pino, etc.).
 *   2. Walk the parent install root's directory tree, checking each
 *      `<dir>/node_modules/<name>/package.json` along the way. Wins
 *      for the pnpm-nested ESM-only cases. The "parent" install root
 *      is needed because pnpm places nested deps under
 *      `<parent-install-root>/../<dep-name>/`, NOT under the parent
 *      directly.
 *   3. Walk up from the repo root the same way (handles the rare case
 *      where a root-of-roots itself is ESM-only).
 */
function resolveInstallRoot(name, parentRequire, parentName, parentRoot, repoRoot) {
  try {
    const pkgJson = parentRequire.resolve(`${name}/package.json`);
    return dirname(realpathSync(pkgJson));
  } catch {}

  if (parentRoot) {
    const found = walkForNodeModules(parentRoot, name);
    if (found) return found;
  }

  const fromRepo = walkForNodeModules(repoRoot, name);
  if (fromRepo) return fromRepo;

  throw new Error(
    `cannot resolve install root for ${name}` +
      (parentName ? ` (parent ${parentName})` : "") +
      `. Run \`pnpm install --frozen-lockfile\` before building native assets.`,
  );
}

/**
 * Walk up from `startDir`, at each level checking
 * `<dir>/node_modules/<name>/package.json`. Returns the package root
 * (with name verified) or null.
 *
 * The verify step matters: pnpm places dependency junctions in a
 * sibling `node_modules/` directory and a name mismatch would mean we
 * grabbed a hoisted but unrelated copy.
 */
function walkForNodeModules(startDir, name) {
  let dir = realpathSync(startDir);
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, "node_modules", name);
    const candidatePkgJson = join(candidate, "package.json");
    if (existsSync(candidatePkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(candidatePkgJson, "utf-8"));
        if (pkg.name === name) {
          return realpathSync(candidate);
        }
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Walk the transitive `dependencies` closure of each native root.
 * `optionalDependencies` / `peerDependencies` are intentionally
 * skipped: the install tree at build time already reflects the
 * package manager's choice for optional peers, so anything we'd want
 * is already a regular dep of whatever pulled it in.
 *
 * `bundleOnlyPackageJson` roots are added to the closure but flagged
 * so the collector only ships their `package.json`.
 */
async function buildClosure(repoRoot) {
  const rootRequire = createRequire(pathToFileURL(resolve(repoRoot, "package.json")));
  const closure = new Map(); // name → { name, root, bundleOnlyPackageJson }

  async function add(name, parentRequire, parentName, parentRoot, bundleOnlyPackageJson) {
    if (closure.has(name)) return;
    const root = resolveInstallRoot(name, parentRequire, parentName, parentRoot, repoRoot);
    closure.set(name, { name, root, bundleOnlyPackageJson });
    if (bundleOnlyPackageJson) return;
    const pkg = await readJson(join(root, "package.json"));
    const deps = pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};
    const requireFromHere = createRequire(pathToFileURL(join(root, "package.json")));
    for (const depName of Object.keys(deps)) {
      await add(depName, requireFromHere, name, root, false);
    }
  }

  for (const r of NATIVE_ROOTS) {
    await add(r.name, rootRequire, null, repoRoot, r.bundleOnlyPackageJson === true);
  }
  return [...closure.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * For one package, choose which files ship. `package-all` mode (the
 * PR1 default) ships every file under the install root EXCEPT the
 * obvious junk (test fixtures, source maps, .ts source files when
 * `dist/` exists). The exclusions keep binary size honest without
 * dropping anything a runtime resolver actually walks for.
 */
async function selectPackageFiles(pkgRoot, bundleOnlyPackageJson) {
  if (bundleOnlyPackageJson) {
    return [join(pkgRoot, "package.json")];
  }
  const all = await listFiles(pkgRoot);
  return all.filter((f) => {
    const rel = relative(pkgRoot, f);
    const parts = rel.split(sep);
    // Drop test / example fixtures, source maps, TypeScript sources.
    if (parts.includes("test") || parts.includes("tests") || parts.includes("__tests__")) {
      return false;
    }
    if (parts.includes("example") || parts.includes("examples")) return false;
    if (parts.includes(".github")) return false;
    if (rel.endsWith(".map")) return false;
    if (rel.endsWith(".ts") && !rel.endsWith(".d.ts")) return false;
    return true;
  });
}

/**
 * Encode the per-file relative path under a stable
 * `node_modules/<pkg>/…` prefix. Bootstrap writes each file at the
 * same path inside the materialise root.
 */
function packageRelative(pkgName, pkgRoot, file) {
  return toPosixPath(`node_modules/${pkgName}/${relative(pkgRoot, file)}`);
}

/**
 * Collect every file every vendored package needs, plus glyph's own
 * `package.json`. Returns the manifest object (suitable for JSON
 * serialisation), the canonical manifest JSON text (used to compute
 * a content hash), and the `{assetKey → sourcePath}` map that
 * `02-sea-blob.mjs` hands to `sea-config.json#assets`.
 */
export async function collectNativeAssets({ repoRoot, target }) {
  const closure = await buildClosure(repoRoot);

  const packages = [];
  const assets = {};

  for (const entry of closure) {
    const files = await selectPackageFiles(entry.root, entry.bundleOnlyPackageJson);
    const fileEntries = [];
    for (const f of files) {
      const rel = packageRelative(entry.name, entry.root, f);
      const buf = await readFile(f);
      const key = `native/${target}/${rel}`;
      fileEntries.push({ assetKey: key, relativePath: rel, sha256: sha256(buf) });
      assets[key] = f;
    }
    packages.push({
      name: entry.name,
      bundleOnlyPackageJson: entry.bundleOnlyPackageJson === true,
      files: fileEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    });
  }

  // Embed glyph's own package.json so the bootstrap can serve it to
  // the CLI's version reader (`<execpath>/(../)*package.json`).
  const glyphPkgJsonPath = join(repoRoot, "package.json");
  const glyphPkgJsonBuf = await readFile(glyphPkgJsonPath);
  assets[PACKAGE_JSON_ASSET_KEY] = glyphPkgJsonPath;
  const glyphPkgJsonSha = sha256(glyphPkgJsonBuf);

  const manifest = {
    version: NATIVE_ASSET_MANIFEST_VERSION,
    target,
    packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
    glyphPackageJson: {
      assetKey: PACKAGE_JSON_ASSET_KEY,
      sha256: glyphPkgJsonSha,
    },
  };
  // contentHash is over the full manifest minus its own contentHash
  // field — i.e. over the file-list and pkg-name list. The bootstrap
  // uses it to pick a deterministic materialise dir keyed to the
  // specific build (a binary rebuild forces re-extraction even if
  // glyph's version didn't change).
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const contentHash = sha256(Buffer.from(manifestJson)).slice(0, 16);
  manifest.contentHash = contentHash;
  const manifestJsonFinal = `${JSON.stringify(manifest, null, 2)}\n`;
  return { manifest, manifestJson: manifestJsonFinal, assets };
}

export function nativeAssetSummary(manifest) {
  return manifest.packages.map(
    (p) => `${p.name}${p.bundleOnlyPackageJson ? " (package.json only)" : ""}: ${p.files.length} files`,
  );
}
