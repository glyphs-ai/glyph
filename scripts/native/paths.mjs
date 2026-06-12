/**
 * Path resolvers for the Single Executable Application (SEA) build.
 *
 * Every native-build script imports paths from here so the output
 * layout under `dist-native/` is described in exactly one place. The
 * shape mirrors the channels we ship through GitHub Releases:
 *
 *   dist-native/
 *     intermediates/                       — esbuild + sea-config + blob
 *       main.cjs                           — the SEA-targeted CJS bundle
 *       sea-config.json                    — input to `node --experimental-sea-config`
 *       glyph.blob                         — the generated SEA blob
 *       native-assets/<target>/manifest.json
 *     bin/<target>/<executableName>        — the final injected binary
 *     smoke-home/                          — GLYPH_HOME for `test:native:smoke`
 *
 * `repoRoot` resolves to the repository root regardless of where the
 * script is invoked from — `import.meta.dirname` is `scripts/native/`,
 * two levels under the root.
 */

import { resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "..", "..");

export function targetTriple({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
} = {}) {
  return env.GLYPH_NATIVE_TARGET ?? `${platform}-${arch}`;
}

export function executableName(platform = process.platform) {
  return platform === "win32" ? "glyph.exe" : "glyph";
}

export function nativeDistRoot() {
  return resolve(repoRoot, "dist-native");
}

export function nativeIntermediatesDir() {
  return resolve(nativeDistRoot(), "intermediates");
}

export function nativeBinDir(target = targetTriple()) {
  return resolve(nativeDistRoot(), "bin", target);
}

export function nativeBinPath(target = targetTriple(), platform = process.platform) {
  return resolve(nativeBinDir(target), executableName(platform));
}

export function nativeJsBundlePath() {
  return resolve(nativeIntermediatesDir(), "main.cjs");
}

export function nativeBlobPath() {
  return resolve(nativeIntermediatesDir(), "glyph.blob");
}

export function nativeSeaConfigPath() {
  return resolve(nativeIntermediatesDir(), "sea-config.json");
}

export function nativeManifestDir(target = targetTriple()) {
  return resolve(nativeIntermediatesDir(), "native-assets", target);
}

export function nativeSmokeHome() {
  return resolve(nativeDistRoot(), "smoke-home");
}

/**
 * SEA's required sentinel fuse, per
 * <https://nodejs.org/api/single-executable-applications.html>.
 * The string is a Node-defined constant; do not change it.
 */
export const SEA_SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/**
 * SEA asset key for the native-asset manifest. Asset keys are arbitrary
 * strings; the bootstrap reads this key first to discover everything
 * else that needs materialising.
 */
export function manifestAssetKey(target = targetTriple()) {
  return `native/${target}/manifest.json`;
}

/**
 * SEA asset key for the root `package.json`. The CLI's version reader
 * looks for `package.json` adjacent to its bundle; in SEA there is no
 * adjacent file, so the bootstrap intercepts those reads and serves the
 * embedded copy from this asset.
 */
export const PACKAGE_JSON_ASSET_KEY = "glyph/package.json";
