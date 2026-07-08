/**
 * Pinning tests for `POST /:sid/spawn`'s response wire shape.
 *
 * This file asserts the on-wire JSON body is BYTE-IDENTICAL for the
 * happy path and for each of the three terminal spawn-failure codes
 * (NoTerminalFoundError, TerminalSpawnFailedError,
 * UnsupportedPlatformError). The body is produced by the real
 * `spawnInteractive` use-case folding a `Spawner` failure into its
 * `{ ok: false, error, code, display }` result.
 *
 * The throw → `SpawnFailed` translation (and the class-name → `code`
 * mapping) is `@glyphs-ai/terminal`'s own concern, exercised by its
 * `local-spawner` boundary tests; here we inject a fake `Spawner` that
 * yields each `SpawnFailed` directly and pin the route's wire body.
 * `buildInteractiveLaunch` is stubbed so the test focuses on the spawn
 * branch without a real repository / runtime.
 */

import type { CatalogModule } from "@glyphs-ai/catalog";
import { type AgentContentSource, InMemoryRuntimeRegistry } from "@glyphs-ai/runtime";
import {
  type AgentResolver,
  applySessionMigrations,
  composeSessionModule,
  type LaunchCommand,
  type ResolvedAgent,
  type SessionModule,
  schema as sessionSchema,
} from "@glyphs-ai/session";
import type { TaskModule } from "@glyphs-ai/task";
import type { Spawner, SpawnFailed } from "@glyphs-ai/terminal";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { sessionsRoutes } from "../../src/routes/sessions.js";
import type { WorkspaceContext } from "../../src/workspace-context.js";

const sampleId = "20260508-9dfbdf05";
const sampleLaunch: LaunchCommand = {
  cmd: "copilot",
  args: ["--session-id=12345678-1234-1234-1234-1234567890ab"],
  cwd: "/tmp/wd",
  display: 'cd "/tmp/wd" && copilot --session-id=12345678-1234-1234-1234-1234567890ab',
};

const unusedResolvedAgent: ResolvedAgent = { agent: { fqn: "demo" }, skills: [], mcps: [] };

/**
 * Build a real session module whose `spawnInteractive` runs against the
 * supplied `Spawner`. `buildInteractiveLaunch` is stubbed to return
 * `sampleLaunch` so no repository row / runtime is needed.
 */
async function buildModule(spawner: Spawner): Promise<SessionModule> {
  const agentResolver: AgentResolver = { resolve: () => okAsync(unusedResolvedAgent) };
  const contentSource: AgentContentSource = {
    async resolveAgent() {
      return unusedResolvedAgent;
    },
    async *agentEntries() {},
    async *skillEntries() {},
    async getMcpRuntimeConfig() {
      return {};
    },
  };
  // Production builds the drizzle handle once in workspace-context and passes
  // it as { db }; mirror that here with a throwaway in-memory client.
  const client = createClient({ url: "file::memory:" });
  await applySessionMigrations(client);
  const db = drizzle(client, { schema: sessionSchema });
  const module = await composeSessionModule({
    db,
    agentResolver,
    contentSource,
    runtimeRegistry: new InMemoryRuntimeRegistry(),
    spawner,
    workspaceDir: "/tmp/wd",
    workspaceId: "ws-pin",
  });
  vi.spyOn(module.buildInteractiveLaunch, "execute").mockReturnValue(okAsync(sampleLaunch));
  // The module holds no handle to close ({ db } is host-owned); release the
  // throwaway client when the caller closes the module.
  return {
    ...module,
    async close() {
      client.close();
    },
  };
}

function buildContext(sessions: SessionModule): WorkspaceContext {
  const ctx: Partial<WorkspaceContext> = {
    sessions,
    catalog: {} as CatalogModule,
    tasks: {} as TaskModule,
  };
  return ctx as WorkspaceContext;
}

describe("POST /:sid/spawn — wire-shape pinning", () => {
  it.each([
    ["NoTerminalFoundError", "No supported terminal emulator was found on this system."],
    ["TerminalSpawnFailedError", "Failed to launch wt: ENOENT"],
    ["UnsupportedPlatformError", "Unsupported platform for terminal launch: aix"],
  ])("JSON body for spawn failure with %s matches the pinned shape byte-for-byte", async (code, message) => {
    const failure: SpawnFailed = { type: "SpawnFailed", code, message };
    const module = await buildModule({ spawn: () => errAsync(failure) });
    try {
      const res = await sessionsRoutes(() => buildContext(module)).request(`/${sampleId}/spawn`, {
        method: "POST",
      });
      // 200 because the HTTP request succeeded; the body carries
      // `ok: false` so the dashboard can distinguish "session is
      // fine, terminal isn't".
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: false,
        error: message,
        code,
        display: sampleLaunch.display,
      });
    } finally {
      await module.close();
    }
  });

  it("JSON body on happy spawn matches the pinned shape byte-for-byte", async () => {
    const module = await buildModule({ spawn: () => okAsync({ launcher: "wt" }) });
    try {
      const res = await sessionsRoutes(() => buildContext(module)).request(`/${sampleId}/spawn`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, launcher: "wt", display: sampleLaunch.display });
    } finally {
      await module.close();
    }
  });
});
