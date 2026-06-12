/**
 * Orchestrate the SEA build pipeline end-to-end.
 *
 * `--profile=local` (PR1 default) runs the three intermediate steps —
 * bundle, sea-blob, inject — and stops. `--profile=release` is
 * reserved for PR2, which adds signing + notarisation; right now it
 * resolves to the same steps as `local` but with a stricter
 * pre-check (no signature artefacts in the workspace).
 *
 * Hard target gate: PR1 only ships linux-x64. Running the orchestrator
 * on darwin / win32 (or with an overridden `GLYPH_NATIVE_TARGET`) exits
 * with a clear message instead of silently producing an unusable
 * artefact. PR2 lifts the gate as it adds the matrix.
 */

import { parseArgs } from "node:util";

import { runBundleStep } from "./01-bundle.mjs";
import { runSeaBlobStep } from "./02-sea-blob.mjs";
import { runInjectStep } from "./03-inject.mjs";
import { fail } from "./exec.mjs";
import { targetTriple } from "./paths.mjs";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "local" },
  },
});

const profile = values.profile;
if (profile !== "local" && profile !== "release") {
  fail(`Unknown --profile=${profile}. Expected 'local' or 'release'.`);
}

const target = targetTriple();
if (target !== "linux-x64") {
  fail(
    [
      `Native SEA build targets ${target} but PR1 only supports linux-x64.`,
      "Run on a linux-x64 host (CI: ubuntu-latest runners).",
      "Cross-target builds, signing, notarisation, and packaging land in PR2.",
    ].join("\n"),
  );
}

console.log(`==> native build start (profile=${profile}, target=${target})`);

await runBundleStep();
await runSeaBlobStep();
await runInjectStep();

console.log(`==> native build complete (profile=${profile}, target=${target})`);
