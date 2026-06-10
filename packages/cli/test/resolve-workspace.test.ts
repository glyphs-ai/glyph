/**
 * Unit tests for `resolveWorkspace` — the CLI's workspace-id resolver.
 *
 * The contract:
 *  - Only PROCESS-LOCAL sources count: the `--workspace` flag and
 *    the `GLYPH_WORKSPACE` env. Both are race-free because no
 *    other client of the glyph server can mutate them.
 *  - There is no server-side workspace lookup: shared server state is
 *    mutable by every CLI process / dashboard tab / external client, so
 *    it cannot safely scope commands.
 *
 * The error message is part of the contract too — it names both
 * process-local workspace sources.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspace } from "../src/connect.js";

describe("resolveWorkspace", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.GLYPH_WORKSPACE;
    delete process.env.GLYPH_WORKSPACE;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GLYPH_WORKSPACE;
    else process.env.GLYPH_WORKSPACE = savedEnv;
  });

  it("returns the --workspace flag when present", async () => {
    const workspaceId = await resolveWorkspace({ workspace: "ws-flag-1" });
    expect(workspaceId).toBe("ws-flag-1");
  });

  it("returns GLYPH_WORKSPACE env when no flag", async () => {
    process.env.GLYPH_WORKSPACE = "ws-env-1";
    const workspaceId = await resolveWorkspace({});
    expect(workspaceId).toBe("ws-env-1");
  });

  it("flag wins over env", async () => {
    process.env.GLYPH_WORKSPACE = "ws-env-loses";
    const workspaceId = await resolveWorkspace({ workspace: "ws-flag-wins" });
    expect(workspaceId).toBe("ws-flag-wins");
  });

  it("trims whitespace from both sources", async () => {
    expect(await resolveWorkspace({ workspace: "  ws-trim-1  " })).toBe("ws-trim-1");
    process.env.GLYPH_WORKSPACE = "  ws-trim-2  ";
    expect(await resolveWorkspace({})).toBe("ws-trim-2");
  });

  it("treats empty string as absent (flag)", async () => {
    process.env.GLYPH_WORKSPACE = "ws-from-env";
    const workspaceId = await resolveWorkspace({ workspace: "" });
    expect(workspaceId).toBe("ws-from-env");
  });

  it("treats empty string as absent (env)", async () => {
    process.env.GLYPH_WORKSPACE = "";
    await expect(resolveWorkspace({})).rejects.toThrow(/no workspace selected/);
  });

  it("throws a usage error when neither source is set", async () => {
    await expect(resolveWorkspace({})).rejects.toThrow(/no workspace selected/);
  });

  it("error message references both --workspace and GLYPH_WORKSPACE", async () => {
    try {
      await resolveWorkspace({});
      expect.fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("--workspace");
      expect(msg).toContain("GLYPH_WORKSPACE");
      expect(msg).toContain("workspace list");
    }
  });

  it("does NOT consult any HTTP source", async () => {
    const start = Date.now();
    await expect(resolveWorkspace({})).rejects.toThrow();
    // Tight bound — we should NOT be waiting for any network round
    // trip. 50ms is generous; a real `client.call` would be much
    // slower even on localhost.
    expect(Date.now() - start).toBeLessThan(50);
  });
});
