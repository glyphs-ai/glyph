import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspacesRoutes } from "@glyphs-ai/api";
import type { WorkspaceId, WorkspaceModule, WorkspaceName } from "@glyphs-ai/workspace";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestId } from "../src/middleware/request-id.js";
import { requestLogger } from "../src/middleware/request-logger.js";
import { captureLogger } from "./_capture-logger.js";
import {
  type ServerTestSubsystem,
  setupTestSubsystem,
  teardownTestSubsystem,
} from "./_test-support.js";

let scratch: string;
const openSubsystems: ServerTestSubsystem[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-server-ws-"));
});
afterEach(async () => {
  for (const sys of openSubsystems.splice(0)) {
    await teardownTestSubsystem(sys);
  }
  await rm(scratch, { recursive: true, force: true });
});

async function makeApp() {
  const sys = await setupTestSubsystem({ scratch });
  openSubsystems.push(sys);
  return {
    app: workspacesRoutes(sys.application),
    workspace: sys.workspace,
    application: sys.application,
    defaultWorkspaceParent: sys.defaultWorkspaceParent,
  };
}

async function register(
  workspace: WorkspaceModule,
  args: { workspaceDir: string; name: string },
): Promise<string> {
  const result = await workspace.registerWorkspace.execute({
    workspaceDir: args.workspaceDir,
    name: args.name as WorkspaceName,
  });
  if (result.isErr()) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

describe("workspacesRoutes — empty registry", () => {
  it("GET / returns []", async () => {
    const { app } = await makeApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("GET /current returns null", async () => {
    const { app } = await makeApp();
    const res = await app.request("/current");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: null });
  });

  it("PUT /current rejects unknown id", async () => {
    const { app } = await makeApp();
    const res = await app.request("/current", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id is idempotent for unknown id (204)", async () => {
    const { app } = await makeApp();
    const res = await app.request("/22222222-2222-4222-8222-222222222222", { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

describe("workspacesRoutes — POST /", () => {
  it("creates a workspace with a generated UUID and registers it", async () => {
    const { app, workspace } = await makeApp();
    const wsDir = path.join(scratch, "ws1");
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceDir: wsDir, name: "Workspace One" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; workspaceDir: string };
    expect(body.name).toBe("Workspace One");
    expect(body.workspaceDir).toBe(path.resolve(wsDir));
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (await workspace.getWorkspace.execute({ id: body.id as WorkspaceId }))._unsafeUnwrap(),
    ).not.toBeNull();
  });

  it("rejects missing name", async () => {
    const { app } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceDir: path.join(scratch, "ws2") }),
    });
    expect(res.status).toBe(400);
  });

  it("auto-generates a UUID-named workspaceDir under defaultWorkspaceParent when omitted", async () => {
    const { app, defaultWorkspaceParent } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no-dir" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; workspaceDir: string };
    expect(body.name).toBe("no-dir");
    const expectedPrefix = path.resolve(defaultWorkspaceParent) + path.sep;
    expect(body.workspaceDir.startsWith(expectedPrefix)).toBe(true);
    expect(path.basename(body.workspaceDir)).toBe(body.id);
  });

  it("rejects empty-string workspaceDir (use omission to pick the default)", async () => {
    const { app } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "blank-dir", workspaceDir: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate workspaceDir", async () => {
    const { app } = await makeApp();
    const wsDir = path.join(scratch, "ws-dup");
    const post = async () =>
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceDir: wsDir, name: "Dup" }),
      });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409);
  });

  it("returns 400 on empty display name", async () => {
    const { app } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceDir: path.join(scratch, "ws-empty"), name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts unicode display names", async () => {
    const { app } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceDir: path.join(scratch, "ws-unicode"), name: "工作区 1" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("工作区 1");
  });

  it("rejects unknown create-body fields", async () => {
    const { app } = await makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "extra-shape",
        workdir: path.join(scratch, "would-have-been-here"),
        defaults: { runtime: "gemini" },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: "ValidationError",
    });
  });
});

describe("workspacesRoutes — list / get / current / delete", () => {
  it("GET / lists registered workspaces", async () => {
    const { app, workspace } = await makeApp();
    await register(workspace, { name: "A", workspaceDir: path.join(scratch, "a") });
    await register(workspace, { name: "B", workspaceDir: path.join(scratch, "b") });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string }[];
    expect(body.map((b) => b.name).sort()).toEqual(["A", "B"]);
  });

  it("GET /:id returns the workspace", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, { name: "Hello", workspaceDir: path.join(scratch, "h") });
    const res = await app.request(`/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(id);
    expect(body.name).toBe("Hello");
  });

  it("GET /:id returns 404 for unknown id", async () => {
    const { app } = await makeApp();
    const res = await app.request("/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("PUT /current sets the current workspace", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, { name: "Cur", workspaceDir: path.join(scratch, "cur") });
    const res = await app.request("/current", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(200);
    expect(
      (await workspace.getLastOpenedWorkspaceId.execute({}).map((r) => r.id))._unsafeUnwrap(),
    ).toBe(id);
  });

  it("DELETE /:id default removes only metadata; user files preserved", async () => {
    const { app, workspace } = await makeApp();
    const workspaceDir = path.join(scratch, "del");
    const id = await register(workspace, { name: "Del", workspaceDir });
    const fs = await import("node:fs/promises");
    await fs.writeFile(path.join(workspaceDir, "user-file.txt"), "user", "utf8");
    const res = await app.request(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(
      (await workspace.getWorkspace.execute({ id: id as WorkspaceId }))._unsafeUnwrap(),
    ).toBeNull();
    expect(await fs.readFile(path.join(workspaceDir, "user-file.txt"), "utf8")).toBe("user");
  });
});

describe("workspacesRoutes — PATCH /:id", () => {
  it("renames the display name", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, { name: "Old", workspaceDir: path.join(scratch, "x") });
    const res = await app.request(`/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("New");
    const storedRes = await workspace.getWorkspace.execute({ id: id as WorkspaceId });
    expect(storedRes.isOk()).toBe(true);
    expect(storedRes._unsafeUnwrap()?.name).toBe("New");
  });

  it("returns 400 when no patchable fields are present", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, { name: "X", workspaceDir: path.join(scratch, "y") });
    const res = await app.request(`/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty display name", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, { name: "X", workspaceDir: path.join(scratch, "z") });
    const res = await app.request(`/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown id (and does not re-create the workspace)", async () => {
    const { app, workspace } = await makeApp();
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await app.request(`/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "anything" }),
    });
    expect(res.status).toBe(404);
    // Strict-update semantics: the rename atomically fails — no row
    // ever appeared.
    expect(
      (await workspace.getWorkspace.execute({ id: id as WorkspaceId }))._unsafeUnwrap(),
    ).toBeNull();
  });
});

//: a force-rebuild endpoint for the per-workspace
// container cache so the dashboard can recover from catalog drift
// (user added an agent yaml from outside glyph and the cached
// `CatalogModule` snapshot is stale) without restarting the server.
describe("workspacesRoutes — POST /:id/reload", () => {
  it("returns 204 on cold cache (no entry yet)", async () => {
    const { app, workspace } = await makeApp();
    const id = await register(workspace, {
      name: "Cold",
      workspaceDir: path.join(scratch, "cold"),
    });
    const res = await app.request(`/${id}/reload`, { method: "POST" });
    expect(res.status).toBe(204);
  });

  it("returns 204 and rebuilds the cached container after a warm hit", async () => {
    const { app, workspace, application } = await makeApp();
    const id = await register(workspace, {
      name: "Warm",
      workspaceDir: path.join(scratch, "warm"),
    });
    const before = await application.getContext(id);
    expect(before).not.toBeNull();
    const res = await app.request(`/${id}/reload`, { method: "POST" });
    expect(res.status).toBe(204);
    const after = await application.getContext(id);
    expect(after).not.toBeNull();
    // Identity check: the cached context must have been replaced.
    expect(after).not.toBe(before);
  });

  it("returns 404 for an unknown workspace id", async () => {
    const { app } = await makeApp();
    const res = await app.request("/00000000-0000-0000-0000-000000000000/reload", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("WorkspaceNotFound");
  });

  it("returns 409 with WorkspaceHasLiveTasksError when tasks are live", async () => {
    const { app, workspace, application } = await makeApp();
    const id = await register(workspace, {
      name: "Live",
      workspaceDir: path.join(scratch, "live"),
    });
    const ctx = await application.getContext(id);
    expect(ctx).not.toBeNull();
    // biome-ignore lint/suspicious/noExplicitAny: test-only stub.
    (ctx as any).tasks.liveCount = () => 3;

    const res = await app.request(`/${id}/reload`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("WorkspaceHasLiveTasksError");
    expect(body.error).toContain("3 live task");
    const stillCached = await application.getContext(id);
    expect(stillCached).toBe(ctx);
  });
});

// Every state-mutating workspace endpoint emits a single structured
// `info` line at the success boundary.
describe("workspacesRoutes — observability", () => {
  async function makeWiredApp() {
    const cap = captureLogger();
    const sys = await setupTestSubsystem({ scratch, logger: cap.logger });
    openSubsystems.push(sys);

    const root = new Hono();
    root.use("*", requestId());
    root.use("*", requestLogger(cap.logger));
    root.route("/", workspacesRoutes(sys.application));

    return {
      root,
      cap,
      workspace: sys.workspace,
      application: sys.application,
    };
  }

  it("POST / emits a 'workspace created' info line carrying the new id", async () => {
    const { root, cap } = await makeWiredApp();
    const res = await root.request("/", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-create" },
      body: JSON.stringify({ workspaceDir: path.join(scratch, "obs-create"), name: "Obs Create" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };

    const evt = cap.entries.find((e) => e.msg === "workspace created");
    expect(evt).toBeDefined();
    expect(evt?.level).toBe(30); // info
    expect(evt?.workspaceId).toBe(body.id);
    expect(evt?.requestId).toBe("req-create");
  });

  it("DELETE /:id emits a 'workspace deleted' info line", async () => {
    const { root, cap, workspace } = await makeWiredApp();
    const id = await register(workspace, {
      name: "Doomed",
      workspaceDir: path.join(scratch, "doomed"),
    });
    cap.entries.length = 0;

    const res = await root.request(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    const evt = cap.entries.find((e) => e.msg === "workspace deleted");
    expect(evt?.workspaceId).toBe(id);
  });
});
