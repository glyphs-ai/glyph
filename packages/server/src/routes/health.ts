import type { HealthResponse } from "@glyphs-ai/api";
import { HealthResponseSchema } from "@glyphs-ai/api";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "./_openapi.js";

/**
 * GET /api/health — unauthenticated liveness + version surface.
 *
 * The endpoint exposes only liveness and clock fields:
 * `status`, `name`, `version`, `startedAt`, `uptimeSec`, and
 * `serverNow` — nothing a network observer couldn't already derive
 * from the running socket.
 *
 * The `HealthResponse` wire shape lives in `@glyphs-ai/api` (its `wire/`
 * surface, reached by the dashboard / CLI through `@glyphs-ai/sdk`) so
 * the dashboard, CLI, and external monitors can typecheck against it
 * without value-importing `@glyphs-ai/server`. The matching
 * `HealthResponseSchema` is the OpenAPI source of truth for the
 * response body.
 *
 * `deps.now` is injected so tests can pin uptime; production passes
 * `() => Date.now()`.
 */
export function healthRoutes(deps: {
  readonly name: string;
  readonly version: string;
  readonly startedAtMs: number;
  readonly now?: () => number;
}): OpenAPIHono {
  const app = createApiApp();
  const now = deps.now ?? (() => Date.now());
  const startedAtIso = new Date(deps.startedAtMs).toISOString();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["system"],
      summary: "Liveness + version probe",
      responses: {
        200: jsonResponse(HealthResponseSchema, "Server liveness and clock fields"),
        500: errorResponse("Internal error"),
      },
    }),
    (c) => {
      const nowMs = now();
      const uptimeSec = Math.max(0, Math.floor((nowMs - deps.startedAtMs) / 1000));
      return c.json<HealthResponse>({
        status: "ok",
        name: deps.name,
        version: deps.version,
        startedAt: startedAtIso,
        uptimeSec,
        serverNow: new Date(nowMs).toISOString(),
      });
    },
  );

  return app;
}
