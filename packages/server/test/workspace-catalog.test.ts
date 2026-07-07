import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Application } from "@glyphs-ai/api";
import { catalogRoutes } from "@glyphs-ai/api";
import type { CatalogModule } from "@glyphs-ai/catalog";
import type { WorkspaceModule, WorkspaceName } from "@glyphs-ai/workspace";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ServerTestSubsystem,
  setupTestSubsystem,
  teardownTestSubsystem,
} from "./_test-support.js";

let scratch: string;
let sys: ServerTestSubsystem;
let workspace: WorkspaceModule;
let application: Application;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-server-cat-"));
  sys = await setupTestSubsystem({ scratch });
  workspace = sys.workspace;
  application = sys.application;
});
afterEach(async () => {
  await teardownTestSubsystem(sys);
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function ensureWorkspace(name: string): Promise<{ id: string; workspaceDir: string }> {
  const workspaceDir = path.join(scratch, name);
  const result = await workspace.registerWorkspace.execute({
    workspaceDir,
    name: name as WorkspaceName,
  });
  if (result.isErr()) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, workspaceDir: path.resolve(workspaceDir) };
}

function mountApp() {
  const app = new Hono<{
    Variables: { catalog: CatalogModule };
  }>();
  app.use("/api/workspaces/:id/catalog/*", async (c, next) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing workspace id" }, 400);
    const ctx = await application.getContext(id);
    if (!ctx) return c.json({ error: "not found", code: "WorkspaceNotFound" }, 404);
    c.set("catalog", ctx.catalog);
    await next();
  });
  app.route(
    "/api/workspaces/:id/catalog",
    catalogRoutes((c) => c.get("catalog")),
  );
  return app;
}

describe("workspace-scoped catalog routes", () => {
  it("404 when workspace id is unknown", async () => {
    const app = mountApp();
    const res = await app.request(
      "/api/workspaces/00000000-0000-4000-8000-000000000000/catalog/agents",
    );
    expect(res.status).toBe(404);
  });

  it("GET overview returns zero counts for a fresh workspace", async () => {
    const ws = await ensureWorkspace("alpha");
    const res = await mountApp().request(`/api/workspaces/${ws.id}/catalog/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts).toEqual({ skills: 0, agents: 0, mcps: 0, blocked: 0, orphaned: 0 });
  });

  it("GET agents/skills/mcps return empty arrays for a fresh workspace", async () => {
    const ws = await ensureWorkspace("alpha");
    const app = mountApp();
    for (const kind of ["agents", "skills", "mcps"]) {
      const res = await app.request(`/api/workspaces/${ws.id}/catalog/${kind}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    }
  });

  it("isolates catalogs between workspaces", async () => {
    const a = await ensureWorkspace("alpha");
    const b = await ensureWorkspace("beta");

    const ctxA = await application.getContext(a.id);
    const ctxB = await application.getContext(b.id);
    expect(ctxA).not.toBeNull();
    expect(ctxB).not.toBeNull();
    if (!ctxA || !ctxB) throw new Error("ctx must exist");

    expect(ctxA.catalog).not.toBe(ctxB.catalog);
    expect(ctxA.workspace.workspaceDir).toBe(a.workspaceDir);
    expect(ctxB.workspace.workspaceDir).toBe(b.workspaceDir);
  });

  it("memoises catalog per workspace", async () => {
    const ws = await ensureWorkspace("alpha");
    const a1 = await application.getContext(ws.id);
    const a2 = await application.getContext(ws.id);
    expect(a1).toBe(a2);
    expect(a1?.catalog).toBe(a2?.catalog);
  });
});
