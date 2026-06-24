/**
 * Smoke test for the published single-file CLI bundle (`bundle/glyph.js`).
 *
 * `pnpm test` never produces this artifact; only `pnpm bundle`
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
 * it FAILS rather than silently skips: an explicit opt-in that can't
 * find the bundle is a real problem the runner asked to be told about.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_AVAILABLE,
  BUNDLE_BIN,
  pickPort,
  runBinAt,
  SCRUBBED_ENV,
} from "../_helpers/cli-bundle.js";

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

  it("`glyph.js status --json` reports healthy after a real bundle boot", async () => {
    // The one happy path that exercises the bundled server end to end:
    // boot it, parse the `status --json` payload, then tear it down.
    const home = await mkdtemp(path.join(tmpdir(), "glyph-bundle-smoke-"));
    const port = pickPort();
    const env = { ...SCRUBBED_ENV, GLYPH_HOME: home };
    try {
      const startRes = await runBinAt(
        BUNDLE_BIN,
        ["start", "--port", String(port), "--no-serve-static"],
        env,
      );
      expect(startRes.exitCode, startRes.stderr).toBe(0);
      const statusRes = await runBinAt(BUNDLE_BIN, ["status", "--json"], env);
      expect(statusRes.exitCode, statusRes.stderr).toBe(0);
      const payload = JSON.parse(statusRes.stdout) as {
        state: string;
        port: number;
        pid: number;
      };
      expect(payload.state).toBe("healthy");
      expect(payload.port).toBe(port);
      expect(typeof payload.pid).toBe("number");
    } finally {
      await runBinAt(BUNDLE_BIN, ["stop"], env).catch(() => {});
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
