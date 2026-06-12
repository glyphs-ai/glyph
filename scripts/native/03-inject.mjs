/**
 * Copy `process.execPath` to `dist-native/bin/<target>/<exe>`, strip
 * the platform signature where present (so `postject` can rewrite the
 * binary without invalidating an embedded code-signature), then
 * `postject` the SEA blob into the copied executable using the fixed
 * fuse sentinel from `paths.mjs`.
 *
 * On linux the signature-strip step is a no-op (ELF doesn't carry a
 * signature in its header the way Mach-O / PE do). PR1 only targets
 * linux, so the macOS / Windows branches are kept as guarded calls
 * that won't run; PR2 picks them up unchanged.
 */

import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { fail, isEntry, run, tryRun } from "./exec.mjs";
import {
  nativeBinDir,
  nativeBinPath,
  nativeBlobPath,
  repoRoot,
  SEA_SENTINEL_FUSE,
  targetTriple,
} from "./paths.mjs";

function postjectBin() {
  // PR1 only runs on linux runners so the `.cmd` branch is dormant —
  // included for parity with the kimi-code template and because PR2
  // will execute this script on Windows runners.
  const cmd = process.platform === "win32" ? "postject.cmd" : "postject";
  return resolve(repoRoot, "node_modules/.bin", cmd);
}

async function ensureBlobExists() {
  try {
    await stat(nativeBlobPath());
  } catch {
    fail(`SEA blob missing at ${nativeBlobPath()}. Run 02-sea-blob.mjs first.`);
  }
}

async function copyNodeExecutable(target) {
  await mkdir(nativeBinDir(target), { recursive: true });
  const out = nativeBinPath(target);
  await copyFile(process.execPath, out);
  if (process.platform !== "win32") {
    await chmod(out, 0o755);
  }
}

async function removeSignatureIfNeeded(target) {
  const out = nativeBinPath(target);
  if (process.platform === "darwin") {
    await tryRun("codesign", ["--remove-signature", out]);
  } else if (process.platform === "win32") {
    await tryRun("signtool", ["remove", "/s", out]);
  }
  // linux: no signature in the ELF, no-op.
}

async function injectBlob(target) {
  const out = nativeBinPath(target);
  const args = [out, "NODE_SEA_BLOB", nativeBlobPath(), "--sentinel-fuse", SEA_SENTINEL_FUSE];
  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }
  await run(postjectBin(), args);
}

export async function runInjectStep() {
  await ensureBlobExists();
  const target = targetTriple();
  await copyNodeExecutable(target);
  await removeSignatureIfNeeded(target);
  await injectBlob(target);
  console.log(`==> injected ${target} binary at ${nativeBinPath(target)}`);
}

const invokedDirect = isEntry(import.meta.url);
if (invokedDirect) {
  await runInjectStep();
}
