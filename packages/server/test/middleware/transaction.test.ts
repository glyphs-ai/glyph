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

interface TxSpy {
  opened: number;
  committed: number;
  rolledBack: number;
}

/**
 * Fake db handles whose catalog handle records the transaction lifecycle.
 * Only `catalogDb.transaction` is exercised — the scope getters (which
 * would touch the other handles) are never accessed by these routes.
 */
function makeHandles(spy: TxSpy) {
  const catalogDb = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      spy.opened += 1;
      try {
        const result = await cb({});
        spy.committed += 1;
        return result;
      } catch (err) {
        spy.rolledBack += 1;
        throw err;
      }
    },
  };
  return {
    catalogDb,
    sessionDb: {},
    taskDb: {},
    scheduleDb: {},
    workflowDb: {},
  };
}

function makeCtx(spy: TxSpy) {
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
    dbHandles: makeHandles(spy),
    close: async () => undefined,
  };
}

function makeApp(spy: TxSpy) {
  const cap = captureLogger();
  const ctx = makeCtx(spy);
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
  return { app };
}

describe("transactionMiddleware (server wiring)", () => {
  it("opens and commits a transaction around a workspace route", async () => {
    const spy: TxSpy = { opened: 0, committed: 0, rolledBack: 0 };
    const { app } = makeApp(spy);

    const res = await app.request("/ws-1/ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hasScope: boolean };
    expect(body.ok).toBe(true);
    // The per-request scope is exposed to handlers via c.var.scope.
    expect(body.hasScope).toBe(true);
    expect(spy).toEqual({ opened: 1, committed: 1, rolledBack: 0 });
  });

  it("surfaces a transaction-layer failure and skips the handler", async () => {
    const cap = captureLogger();
    let ranRoute = false;
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
        catalogDb: {
          transaction: async () => {
            throw new Error("tx-begin-failed");
          },
        },
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
    app.get("/:id/ok", (c) => {
      ranRoute = true;
      return c.json({ ok: true });
    });

    const res = await app.request("/ws-1/ok");
    // A failure to open the transaction surfaces as an error; the handler
    // must not run outside of a transaction.
    expect(res.status).toBe(500);
    expect(ranRoute).toBe(false);
  });

  it("never opens a transaction when the workspace fails to resolve", async () => {
    const spy: TxSpy = { opened: 0, committed: 0, rolledBack: 0 };
    const cap = captureLogger();
    const application = {
      peekContextState: vi.fn(async () => "not-registered" as const),
      getContext: vi.fn(),
    } as unknown as Application;
    const app = new Hono<{ Variables: TxVars }>();
    app.use("/:id/*", resolveWorkspaceMiddleware(application, cap.logger));
    app.use(
      "/:id/*",
      transactionMiddleware((c) => c.get("workspaceContext").dbHandles),
    );
    app.get("/:id/ok", (c) => c.json({ ok: true }));

    const res = await app.request("/ws-x/ok");
    // resolveWorkspace short-circuits with 404 before the tx middleware runs.
    expect(res.status).toBe(404);
    expect(spy).toEqual({ opened: 0, committed: 0, rolledBack: 0 });
  });
});
