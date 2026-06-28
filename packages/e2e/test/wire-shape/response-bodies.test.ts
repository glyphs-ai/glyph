/**
 * Runtime validation of the highest-fanout GET response bodies against
 * their `@glyphs-ai/api` wire shapes.
 *
 * TypeScript's `c.json<T>(value)` only checks the handler's object
 * literal at compile time; response tests that cast parsed JSON
 * (`(await res.json()) as HealthResponse`) are no-ops at runtime. A
 * handler that drops `serverNow`, renames `uptimeSec`, or leaks an
 * extra field would pass both the type-check AND those tests. This
 * suite boots a real server and asserts the exact key set (so additive
 * drift and omissions both fail) plus value types for /api/health,
 * /api/runtimes, and /api/workspaces.
 *
 * One server boot for the whole file (mirrors integration-smoke).
 * Skips cleanly when the CLI bundle (`packages/cli/dist/bin.js`) is
 * absent, exactly like the other spawn-based suites.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BIN_AVAILABLE, pickPort, runBin, SCRUBBED_ENV } from "../_helpers/cli-bundle.js";

let home: string;
let port: number;
let env: NodeJS.ProcessEnv;

async function getJson(routePath: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${routePath}`);
  expect(res.ok, `GET ${routePath} -> HTTP ${res.status}`).toBe(true);
  return res.json();
}

describe.skipIf(!BIN_AVAILABLE).sequential("wire-shape: GET response bodies", () => {
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "glyph-wire-shape-"));
    port = pickPort();
    env = { ...SCRUBBED_ENV, GLYPH_HOME: home };
    const startRes = await runBin(["start", "--port", String(port), "--no-serve-static"], env);
    if (startRes.exitCode !== 0) {
      throw new Error(`server failed to start (exit ${startRes.exitCode}): ${startRes.stderr}`);
    }
    // Register one workspace so /api/workspaces returns a populated row.
    const addRes = await runBin(
      ["workspace", "add", "--name", "Sandbox", "--workspace-dir", path.join(home, "ws"), "--json"],
      env,
    );
    if (addRes.exitCode !== 0) {
      throw new Error(`workspace add failed (exit ${addRes.exitCode}): ${addRes.stderr}`);
    }
  });

  afterAll(async () => {
    try {
      await runBin(["stop"], env);
    } catch {
      // Best-effort teardown; never mask a real test failure.
    }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("GET /api/health body matches HealthResponse keys + value types", async () => {
    const body = await getJson("/api/health");
    expect(Object.keys(body as object).sort()).toEqual([
      "name",
      "serverNow",
      "startedAt",
      "status",
      "uptimeSec",
      "version",
    ]);
    expect(body).toMatchObject({
      status: "ok",
      name: expect.any(String),
      version: expect.any(String),
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      uptimeSec: expect.any(Number),
      serverNow: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
  });

  it("GET /api/runtimes items match RuntimeInfo keys and include copilot", async () => {
    const body = await getJson("/api/runtimes");
    expect(Array.isArray(body)).toBe(true);
    const runtimes = body as Array<Record<string, unknown>>;
    expect(runtimes.length).toBeGreaterThan(0);
    for (const runtime of runtimes) {
      expect(Object.keys(runtime).sort()).toEqual(["capabilities", "kind"]);
      expect(typeof runtime.kind).toBe("string");
      expect(typeof runtime.capabilities).toBe("object");
    }
    expect(runtimes.map((r) => r.kind)).toContain("copilot");
  });

  it("GET /api/workspaces items match Workspace keys", async () => {
    const body = await getJson("/api/workspaces");
    expect(Array.isArray(body)).toBe(true);
    const workspaces = body as Array<Record<string, unknown>>;
    expect(workspaces.length).toBeGreaterThan(0);
    for (const ws of workspaces) {
      expect(Object.keys(ws).sort()).toEqual([
        "createdAt",
        "id",
        "lastOpenedAt",
        "name",
        "workspaceDir",
      ]);
    }
  });
});
