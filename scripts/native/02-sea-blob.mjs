/**
 * Produce the SEA blob from the CJS bundle plus the vendored native
 * assets. Three sub-steps:
 *
 *   1. Walk every vendored package (the closure defined by
 *      `native-deps.mjs`) and write the asset manifest to
 *      `dist-native/intermediates/native-assets/<target>/manifest.json`.
 *
 *   2. Write `dist-native/intermediates/sea-config.json` referencing
 *      the manifest + every per-file asset by stable key.
 *
 *   3. Invoke `node --experimental-sea-config <config>` which generates
 *      `dist-native/intermediates/glyph.blob`.
 *
 * `useSnapshot: false` because the bundle's top-level evaluation
 * imports `node:fs` and friends — `--use-snapshot` requires the main
 * module to be snapshot-safe, which our bootstrap-then-bundle layout
 * is not. The official Node doc explicitly notes this as the default
 * trade-off for the assets-only mode we use.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { collectNativeAssets, manifestAssetKey, nativeAssetSummary } from "./assets.mjs";
import { fail, isEntry, run } from "./exec.mjs";
import {
  nativeBlobPath,
  nativeIntermediatesDir,
  nativeJsBundlePath,
  nativeManifestDir,
  nativeSeaConfigPath,
  repoRoot,
  targetTriple,
} from "./paths.mjs";

async function ensureBundleExists() {
  try {
    await stat(nativeJsBundlePath());
  } catch {
    fail(`SEA bundle missing at ${nativeJsBundlePath()}. Run 01-bundle.mjs first.`);
  }
}

async function writeSeaConfig(target) {
  await mkdir(nativeIntermediatesDir(), { recursive: true });
  const { manifest, manifestJson, assets } = await collectNativeAssets({ repoRoot, target });

  const manifestPath = resolve(nativeManifestDir(target), "manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, manifestJson);

  const seaAssets = {
    [manifestAssetKey(target)]: manifestPath,
    ...assets,
  };
  const config = {
    main: nativeJsBundlePath(),
    output: nativeBlobPath(),
    assets: Object.fromEntries(
      Object.entries(seaAssets).sort(([a], [b]) => a.localeCompare(b)),
    ),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  };
  await writeFile(nativeSeaConfigPath(), `${JSON.stringify(config, null, 2)}\n`);

  console.log(`==> collected native assets for ${manifest.target}:`);
  for (const line of nativeAssetSummary(manifest)) console.log(`  - ${line}`);
  console.log(`==> total assets in sea-config: ${Object.keys(seaAssets).length}`);
  console.log(`==> manifest contentHash: ${manifest.contentHash}`);
}

export async function runSeaBlobStep() {
  await ensureBundleExists();
  const target = targetTriple();
  await writeSeaConfig(target);
  console.log(`==> node --experimental-sea-config ${nativeSeaConfigPath()}`);
  await run(process.execPath, ["--experimental-sea-config", nativeSeaConfigPath()]);
}

const invokedDirect = isEntry(import.meta.url);
if (invokedDirect) {
  await runSeaBlobStep();
}
