/**
 * Smoke test for the published single-file CLI bundle (`bundle/glyph.js`).
 *
 * `pnpm test` never produces this artifact — only `pnpm bundle`
 * (release / E2E) does, inlining the drizzle migrations and the
 * dashboard dist into one esbuild output. The per-package `dist/bin.js`
 * smoke in spawn-smoke imports that package's own build and so cannot
 * catch regressions in the bundle step itself: a dropped migration, a
 * broken dashboard copy, or an ESM/CJS interop fault that only surfaces
 * in the single-file form. This suite execs the real bundle to close
 * that gap.
 *
 * Gated behind the `BUNDLE_SMOKE` env flag because the artifact is
 * absent in a plain `pnpm test`. To run it:
 *
 *   pnpm bundle
 *   BUNDLE_SMOKE=1 pnpm --filter @glyphs-ai/e2e test
 *
 * When the flag is set the suite runs; if the artifact is then missing
 * it FAILS rather than silently skips — an explicit opt-in that can't
 * find the bundle is a real problem the runner asked to be told about.
 */

import { describe, expect, it } from "vitest";
import { BUNDLE_AVAILABLE, BUNDLE_BIN, runBinAt, SCRUBBED_ENV } from "../_helpers/cli-bundle.js";

const BUNDLE_SMOKE = process.env.BUNDLE_SMOKE === "1";

describe.skipIf(!BUNDLE_SMOKE)("bundle smoke (single-file glyph.js)", () => {
  it("the bundle artifact exists (run `pnpm bundle` first)", () => {
    expect(
      BUNDLE_AVAILABLE,
      `expected the bundled CLI at ${BUNDLE_BIN}; run \`pnpm bundle\` before BUNDLE_SMOKE=1`,
    ).toBe(true);
  });

  it("`glyph.js --version` exits 0 with a semver", async () => {
    const r = await runBinAt(BUNDLE_BIN, ["--version"], { ...SCRUBBED_ENV });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("`glyph.js --help` exits 0 and lists known subcommands", async () => {
    const r = await runBinAt(BUNDLE_BIN, ["--help"], { ...SCRUBBED_ENV });
    expect(r.exitCode, r.stderr).toBe(0);
    // Assert two well-known subcommands rather than the full list so a
    // single command rename doesn't ripple into a bundle-smoke flake.
    expect(r.stdout).toContain("workspace");
    expect(r.stdout).toContain("task");
  });
});
