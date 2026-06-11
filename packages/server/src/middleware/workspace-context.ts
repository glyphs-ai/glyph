import { type Application, type WorkspaceContext, WorkspaceLoadError } from "@glyphs-ai/api";
import type { MiddlewareHandler } from "hono";
import type { Logger as PinoLogger } from "pino";
import { errorBody } from "../routes/_shared.js";

/**
 * Variables stashed on the Hono context by the workspace context
 * middleware. Routes pull `c.get("workspaceContext")` and reach
 * services off the context (e.g. `.sessions`, `.catalog`).
 */
export type WorkspaceVars = {
  workspaceContext: WorkspaceContext;
};

/**
 * Time the middleware is willing to block on a cold per-workspace
 * load before falling back to a 202 + Retry-After response. The
 * load itself keeps running in the background; the next request
 * sees `"loading"` and gets an immediate 202.
 */
export const COLD_LOAD_RACE_MS = 500;

/**
 * Hono middleware: pulls `:id` from the route params, asks the
 * application for its `WorkspaceContext`, and stashes it on
 * `c.var.workspaceContext` as a single field. Sub-routes pull
 * whichever service they need off the context (sessions read
 * `c.get("workspaceContext").sessions`; catalog reads
 * `c.get("workspaceContext").catalog`; etc.).
 *
 * Warming-up protocol:
 *   - 400 if `:id` is missing (defensive — Hono route shape enforces it)
 *   - 404 if the workspaceId is not registered (`peek` ➜ "not-registered")
 *   - 200 path: context is cached OR loads within {@link COLD_LOAD_RACE_MS} ➜ next()
 *   - 202 + `Retry-After: 2` if a prior `get()` is mid-flight OR a
 *     fresh load is still pending after the grace window
 *   - 503 + `Retry-After: 5` if the per-workspace `load()` throws —
 *     surfaces the failure as `WorkspaceLoadError` through the
 *     standard `errorBody` envelope (no host paths leak)
 *
 * The grace window lets fast cold loads bypass the warming round-trip
 * entirely; slow loads hand the client a typed 202 to back off on
 * instead of a stalled connection.
 */
export function workspaceContextMiddleware(
  application: Application,
  logger: PinoLogger,
): MiddlewareHandler<{ Variables: WorkspaceVars }> {
  return async (c, next) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing workspace id" }, 400);

    const state = await application.peekContextState(id);

    if (state === "not-registered") {
      return c.json(
        { error: `workspace "${id}" is not registered`, code: "WorkspaceNotRegisteredError" },
        404,
      );
    }

    if (state === "loading") {
      return c.json({ state: "warming", workspaceId: id }, 202, { "Retry-After": "2" });
    }

    if (state === "cached") {
      const ctx = await application.getContext(id);
      if (!ctx) {
        // Race: a concurrent invalidate wiped the entry between
        // peek and get. Surface as 404 — caller's next request will
        // see "not-registered" on peek.
        return c.json(
          { error: `workspace "${id}" is not registered`, code: "WorkspaceNotRegisteredError" },
          404,
        );
      }
      c.set("workspaceContext", ctx);
      return next();
    }

    // state === "unloaded": kick off a load and race a short timer.
    // The load Promise is fire-and-forget from the response's
    // perspective — if the timer wins, the load continues in the
    // background and the next request will find it "loading".
    let timer: NodeJS.Timeout | undefined;
    const timeoutP = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), COLD_LOAD_RACE_MS);
    });

    const loadP = application.getContext(id).then(
      (ctx) => ({ kind: "ok" as const, ctx }),
      (err: unknown) => ({ kind: "err" as const, err }),
    );

    const winner = await Promise.race([loadP, timeoutP]);
    if (timer) clearTimeout(timer);

    if (winner === "timeout") {
      // Load is still in flight. Let it keep running in the
      // background; the next request sees "loading" and gets the
      // same 202. Swallow any throw the background load produces —
      // the actual failure will surface to whoever calls getContext
      // next, including the next attempt at this same workspace.
      loadP.catch(() => {
        /* surfaces through the middleware's own 503 path on next access */
      });
      return c.json({ state: "warming", workspaceId: id }, 202, { "Retry-After": "2" });
    }

    if (winner.kind === "err") {
      const wrapped = new WorkspaceLoadError(id, winner.err);
      logger.error({ err: wrapped, workspaceId: id }, "workspace cold-load failed");
      return c.json(errorBody(wrapped), 503, { "Retry-After": "5" });
    }

    if (!winner.ctx) {
      // Workspace was unregistered between peek and load — surface
      // as 404 like a stable not-registered.
      return c.json(
        { error: `workspace "${id}" is not registered`, code: "WorkspaceNotRegisteredError" },
        404,
      );
    }

    c.set("workspaceContext", winner.ctx);
    return next();
  };
}
