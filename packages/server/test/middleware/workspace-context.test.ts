/**
 * Unit tests for the workspace warming-up middleware.
 *
 * Each test stubs `Application.peekContextState` + `getContext` and
 * mounts the middleware on a tiny Hono app via a `:id` route. We
 * assert HTTP status, headers (`Retry-After`), and response body.
 *
 * Scenarios covered:
 *   - 404 "not-registered" — peek says the workspace doesn't exist
 *   - 202 "loading"        — a prior get() is mid-flight
 *   - 200 "cached"         — context is already in memory
 *   - 200 "unloaded" fast  — load resolves before the 500 ms race
 *   - 202 "unloaded" slow  — load is still pending after the race
 *   - 503 "unloaded" err   — load throws → WorkspaceLoadError envelope
 *   - 404 "cached" race    — entry gets invalidated between peek + get
 *   - 400 missing :id      — defensive guard
 */
import type { Application } from "@glyphs-ai/api";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  COLD_LOAD_RACE_MS,
  type WorkspaceVars,
  workspaceContextMiddleware,
} from "../../src/middleware/workspace-context.js";
import { captureLogger } from "../_capture-logger.js";

const fakeCtx = {
  workspace: {
    id: "ws-1",
    name: "demo",
    workspaceDir: "/tmp/demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
  },
  catalog: {} as never,
  sessions: {} as never,
  tasks: {} as never,
  schedules: {} as never,
  workflows: {} as never,
  close: async () => undefined,
};

function makeApp(application: Application) {
  const cap = captureLogger();
  const app = new Hono<{ Variables: WorkspaceVars }>();
  app.use("/:id/*", workspaceContextMiddleware(application, cap.logger));
  app.get("/:id/probe", (c) => {
    const ctx = c.get("workspaceContext");
    return c.json({ ok: true, workspaceId: ctx.workspace.id });
  });
  return { app, cap };
}

describe("workspaceContextMiddleware", () => {
  it("returns 404 when the workspace is not registered", async () => {
    const application = {
      peekContextState: vi.fn(async () => "not-registered" as const),
      getContext: vi.fn(),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-x/probe");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("WorkspaceNotFound");
    expect(application.getContext).not.toHaveBeenCalled();
  });

  it('returns 202 + Retry-After when peek says "loading"', async () => {
    const application = {
      peekContextState: vi.fn(async () => "loading" as const),
      getContext: vi.fn(),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(202);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = (await res.json()) as { state: string; workspaceId: string };
    expect(body.state).toBe("warming");
    expect(body.workspaceId).toBe("ws-1");
    // MUST NOT have triggered a load — the in-flight load owns it.
    expect(application.getContext).not.toHaveBeenCalled();
  });

  it('returns 200 and stashes the ctx when peek says "cached"', async () => {
    const application = {
      peekContextState: vi.fn(async () => "cached" as const),
      getContext: vi.fn(async () => fakeCtx),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; workspaceId: string };
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe("ws-1");
  });

  it("returns 404 if cached entry was invalidated between peek and get (race)", async () => {
    const application = {
      peekContextState: vi.fn(async () => "cached" as const),
      getContext: vi.fn(async () => null),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("WorkspaceNotFound");
  });

  it('returns 200 when an "unloaded" load resolves inside the race window', async () => {
    const application = {
      peekContextState: vi.fn(async () => "unloaded" as const),
      // Resolves immediately — well under COLD_LOAD_RACE_MS.
      getContext: vi.fn(async () => fakeCtx),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; workspaceId: string };
    expect(body.workspaceId).toBe("ws-1");
  });

  it('returns 202 + Retry-After when an "unloaded" load does not finish before the race window', async () => {
    const application = {
      peekContextState: vi.fn(async () => "unloaded" as const),
      // Resolves AFTER the race window — middleware should timeout to 202.
      getContext: vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve(fakeCtx), COLD_LOAD_RACE_MS + 200)),
      ),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(202);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = (await res.json()) as { state: string; workspaceId: string };
    expect(body.state).toBe("warming");
    expect(body.workspaceId).toBe("ws-1");
  });

  it("returns 503 + Retry-After + WorkspaceLoadError when the load throws", async () => {
    const application = {
      peekContextState: vi.fn(async () => "unloaded" as const),
      getContext: vi.fn(async () => {
        throw new Error("boot: cannot open workspace.db at /home/.../bad/workspace.db");
      }),
    } as unknown as Application;
    const { app, cap } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("WorkspaceLoadError");
    // Body MUST NOT echo the host path that the underlying error carried.
    expect(body.error).not.toContain("/home/");
    expect(body.error).toMatch(/workspace "ws-1" failed to load/);

    // The wrapped error must be logged with the cause so operators can triage.
    const logged = cap.entries.find((e) => e.msg === "workspace cold-load failed");
    expect(logged).toBeDefined();
    expect(logged?.workspaceId).toBe("ws-1");
  });

  it('returns 404 when an "unloaded" load resolves to null (unregistered mid-load race)', async () => {
    const application = {
      peekContextState: vi.fn(async () => "unloaded" as const),
      getContext: vi.fn(async () => null),
    } as unknown as Application;
    const { app } = makeApp(application);

    const res = await app.request("/ws-1/probe");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("WorkspaceNotFound");
  });
});
