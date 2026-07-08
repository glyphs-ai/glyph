/**
 * Integration test for the request-scoped transaction middleware as it is
 * wired in `runServer`: `resolveWorkspaceMiddleware` populates
 * `workspaceContext`, then `transactionMiddleware` opens a libsql
 * transaction around the downstream handler via
 * `dbHandles.catalogDb.transaction(...)` and exposes the per-request scope
 * on `c.var.scope`.
 *
 * These tests assert the server-layer wiring: the middleware runs after
 * resolveWorkspace, opens a transaction that commits around a clean
 * handler, exposes the scope, surfaces a transaction-layer failure instead
 * of swallowing it, and never runs when workspace resolution
 * short-circuits. The drizzle transaction's atomic commit/rollback
 * semantics are covered at the api layer.
 */
import type { Application } from "@glyphs-ai/api";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  resolveWorkspaceMiddleware,
  type WorkspaceVars,
} from "../../src/middleware/resolve-workspace.js";
import { type RequestScope, transactionMiddleware } from "../../src/middleware/transaction.js";
import { captureLogger } from "../_capture-logger.js";

/** Hono variables available once both middlewares have run. */
type TxVars = WorkspaceVars & { scope: RequestScope };

/**
 * Fake db handles whose `db.run` mock records BEGIN/COMMIT/ROLLBACK calls.
 */
function makeHandles() {
  const db = {
    run: vi.fn(async () => undefined),
  };
  return {
    db,
    catalogDb: {},
    sessionDb: {},
    taskDb: {},
    scheduleDb: {},
    workflowDb: {},
  };
}

function makeCtx() {
  return {
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
    dbHandles: makeHandles(),
    close: async () => undefined,
  };
}

function makeApp() {
  const cap = captureLogger();
  const ctx = makeCtx();
  const application = {
    peekContextState: vi.fn(async () => "cached" as const),
    getContext: vi.fn(async () => ctx),
  } as unknown as Application;
  const app = new Hono<{ Variables: TxVars }>();
  app.use("/:id/*", resolveWorkspaceMiddleware(application, cap.logger));
  app.use(
    "/:id/*",
    transactionMiddleware((c) => c.get("workspaceContext").dbHandles),
  );
  app.get("/:id/ok", (c) => c.json({ ok: true, hasScope: c.get("scope") !== undefined }));
  app.post("/:id/write", (c) => c.json({ ok: true, hasScope: c.get("scope") !== undefined }));
  return { app, ctx };
}

describe("transactionMiddleware (server wiring)", () => {
  it("does not open a transaction for GET requests (concurrent reads)", async () => {
    const { app, ctx } = makeApp();

    const res = await app.request("/ws-1/ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hasScope: boolean };
    expect(body.ok).toBe(true);
    expect(body.hasScope).toBe(true);
    // No transaction opened for reads — WAL handles concurrent readers.
    expect(ctx.dbHandles.db.run).not.toHaveBeenCalled();
  });

  it("opens and commits a DEFERRED transaction for POST requests", async () => {
    const { app, ctx } = makeApp();

    const res = await app.request("/ws-1/write", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hasScope: boolean };
    expect(body.ok).toBe(true);
    expect(body.hasScope).toBe(true);
    // BEGIN DEFERRED + COMMIT
    const calls = ctx.dbHandles.db.run.mock.calls as unknown[][];
    expect(calls.length).toBe(2);
    expect((calls[0]![0] as { queryChunks: { value: string[] }[] }).queryChunks[0].value[0]).toBe(
      "BEGIN DEFERRED",
    );
    expect((calls[1]![0] as { queryChunks: { value: string[] }[] }).queryChunks[0].value[0]).toBe(
      "COMMIT",
    );
  });

  it("rolls back when the handler throws (write request)", async () => {
    const cap = captureLogger();
    const dbRun = vi.fn(async () => undefined);
    const ctx = {
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
      dbHandles: {
        db: { run: dbRun },
        catalogDb: {},
        sessionDb: {},
        taskDb: {},
        scheduleDb: {},
        workflowDb: {},
      },
      close: async () => undefined,
    };
    const application = {
      peekContextState: vi.fn(async () => "cached" as const),
      getContext: vi.fn(async () => ctx),
    } as unknown as Application;
    const app = new Hono<{ Variables: TxVars }>();
    app.use("/:id/*", resolveWorkspaceMiddleware(application, cap.logger));
    app.use(
      "/:id/*",
      transactionMiddleware((c) => c.get("workspaceContext").dbHandles),
    );
    app.post("/:id/explode", () => {
      throw new Error("handler-threw");
    });

    const res = await app.request("/ws-1/explode", { method: "POST" });
    expect(res.status).toBe(500);
    // Handler threw → Hono sets c.error + 500 response → middleware detects
    // and rolls back instead of committing partial writes.
    const calls = dbRun.mock.calls as unknown[][];
    expect(calls.length).toBe(2);
    expect((calls[0]![0] as { queryChunks: { value: string[] }[] }).queryChunks[0].value[0]).toBe(
      "BEGIN DEFERRED",
    );
    expect((calls[1]![0] as { queryChunks: { value: string[] }[] }).queryChunks[0].value[0]).toBe(
      "ROLLBACK",
    );
  });

  it("resolveWorkspace short-circuits before tx middleware runs", async () => {
    const { app, ctx } = makeApp();
    // Override: make peekContextState return not-registered for ws-x
    const cap = captureLogger();
    const application = {
      peekContextState: vi.fn(async () => "not-registered" as const),
      getContext: vi.fn(),
    } as unknown as Application;
    const isolatedApp = new Hono<{ Variables: TxVars }>();
    const dbRun = vi.fn(async () => undefined);
    const isolatedHandles = {
      db: { run: dbRun },
      catalogDb: {},
      sessionDb: {},
      taskDb: {},
      scheduleDb: {},
      workflowDb: {},
    } as never;
    isolatedApp.use("/:id/*", resolveWorkspaceMiddleware(application, cap.logger));
    isolatedApp.use(
      "/:id/*",
      transactionMiddleware(() => isolatedHandles),
    );
    isolatedApp.get("/:id/ok", (c) => c.json({ ok: true }));

    const res = await isolatedApp.request("/ws-x/ok");
    // resolveWorkspace short-circuits with 404 before the tx middleware runs.
    expect(res.status).toBe(404);
    expect(dbRun).not.toHaveBeenCalled();
  });
});
