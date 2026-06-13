/**
 * CLI assertions for surfacing resolve-pipeline conflicts on
 * `catalog {skill,agent,mcp} install`. The server may return a
 * non-empty `conflicts[]` describing deps the install dropped silently
 * (e.g. a frontmatter origin whose anchor file failed to fetch); the
 * CLI emits a non-fatal `warning:` block to stderr and exits 0.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "./_helpers/run-cli.js";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "glyph-cli-conflict-surface-"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SERVER_URL = "http://stub.local";

function env(): Record<string, string | undefined> {
  return {
    GLYPH_HOME: home,
    GLYPH_SERVER: SERVER_URL,
    GLYPH_WORKSPACE: "ws-1",
  };
}

function stubResponse(responseBody: string): void {
  let called = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (called) return new Response("unexpected second fetch", { status: 500 });
    called = true;
    return new Response(responseBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const CONFLICT_BODY = JSON.stringify({
  installed: [{ kind: "agent", fqn: "localtest/coordinator-test" }],
  skipped: [],
  failed: [],
  conflicts: [
    {
      kind: "agent",
      origin: "file:/missing/engineer/AGENTS.md",
      fqn: null,
      reason: {
        kind: "fetch-failed",
        cause: { message: "ENOENT: no such file" },
      },
    },
  ],
});

const NO_CONFLICT_BODY = JSON.stringify({
  installed: [{ kind: "agent", fqn: "localtest/coordinator-test" }],
  skipped: [],
  failed: [],
  conflicts: [],
});

describe("catalog install surfaces resolve-pipeline conflicts to stderr", () => {
  it("emits a `warning:` block when the server returns conflicts and still exits 0", async () => {
    stubResponse(CONFLICT_BODY);
    const r = await runCli(["catalog", "agent", "install", "--file", "/some/coord"], env());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^warning:/m);
    expect(r.stderr).toMatch(/1 dependency was not installed/);
    expect(r.stderr).toContain("agent file:/missing/engineer/AGENTS.md");
    expect(r.stderr).toMatch(/reason: fetch-failed/);
    expect(r.stderr).toMatch(/fix:/);
  });

  it("emits no warning block when the server returns conflicts: []", async () => {
    stubResponse(NO_CONFLICT_BODY);
    const r = await runCli(["catalog", "agent", "install", "--file", "/some/coord"], env());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("round-trips `conflicts` into stdout JSON", async () => {
    stubResponse(CONFLICT_BODY);
    const r = await runCli(["catalog", "agent", "install", "--file", "/some/coord"], env());
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as { conflicts: { kind: string }[] };
    expect(Array.isArray(parsed.conflicts)).toBe(true);
    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0]?.kind).toBe("agent");
  });

  it("surfaces conflicts uniformly across skill / agent / mcp install commands", async () => {
    for (const argv of [
      ["catalog", "skill", "install", "--file", "/some/coord"],
      ["catalog", "agent", "install", "--file", "/some/coord"],
      ["catalog", "mcp", "install", "--file", "/some/coord.json"],
    ]) {
      stubResponse(CONFLICT_BODY);
      const r = await runCli(argv, env());
      expect(r.exitCode, `${argv.join(" ")}: ${r.stderr}`).toBe(0);
      expect(r.stderr).toMatch(/^warning:/m);
      vi.restoreAllMocks();
    }
  });

  it("tolerates a server response that omits the `conflicts` field", async () => {
    // Forward-compat: an older server response without the field
    // must not throw or emit a stray warning block — treat as zero
    // conflicts.
    stubResponse(JSON.stringify({ installed: [], skipped: [], failed: [] }));
    const r = await runCli(["catalog", "agent", "install", "--file", "/some/coord"], env());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
  });
});
