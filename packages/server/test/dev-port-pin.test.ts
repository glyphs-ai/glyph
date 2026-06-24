import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Coupling guard for the dev-time API port, which is duplicated across
 * two files that have no compile-time link:
 *
 *   - `packages/server/package.json` `scripts.dev` starts the dev API on
 *     `PORT=<n>` (via cross-env).
 *   - `packages/dashboard/vite.config.ts` proxies `/api/*` to
 *     `http://localhost:<n>`.
 *
 * If the two literals drift, dev `/api/*` requests silently ECONNREFUSED
 * with no useful error. The `_devPortNote` field in package.json points
 * here; this test is the enforcement the note used to only describe.
 *
 * Both files are read as text rather than imported: the dashboard config
 * is in another package and pulling it in as a module would create a
 * build-time dependency this transport package must not have.
 */
const SERVER_DIR = join(import.meta.dirname, "..");
const SERVER_PACKAGE_JSON = join(SERVER_DIR, "package.json");
const DASHBOARD_VITE_CONFIG = join(SERVER_DIR, "..", "dashboard", "vite.config.ts");

function captureOne(source: string, pattern: RegExp, label: string): string {
  const value = source.match(pattern)?.[1];
  if (value === undefined) {
    throw new Error(`dev-port-pin: could not find ${label} (pattern ${pattern})`);
  }
  return value;
}

describe("dev port pin", () => {
  it("server dev PORT matches the dashboard vite /api proxy target", () => {
    const pkg = readFileSync(SERVER_PACKAGE_JSON, "utf8");
    const viteConfig = readFileSync(DASHBOARD_VITE_CONFIG, "utf8");

    const devScript = captureOne(pkg, /"dev":\s*"([^"]+)"/, "scripts.dev in package.json");
    const serverPort = captureOne(devScript, /PORT=(\d+)/, "PORT in scripts.dev");
    const proxyPort = captureOne(
      viteConfig,
      /["']\/api["']\s*:\s*["']http:\/\/localhost:(\d+)["']/,
      "the /api proxy target in vite.config.ts",
    );

    expect(serverPort).toBe(proxyPort);
  });
});
