import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "../_http-helpers.js";

/**
 * Wire schema + inferred type for `GET /api/health`. Single source of truth
 * for the OpenAPI projection and the response body's compile-time shape.
 *
 * Sensitive values are deliberately NOT exposed: the endpoint is
 * unauthenticated so it can serve the dashboard backoff probe before the user
 * has supplied an API key, and so external monitors don't need credentials.
 * Anything you'd hide from a stranger on the network does not belong here.
 */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  /** Server package name, e.g. `"@glyphs-ai/server"`. */
  name: z.string(),
  /** Server semver, e.g. `"0.0.1"`. */
  version: z.string(),
  /** ISO 8601 UTC timestamp when this server process started. */
  startedAt: z.string(),
  /** Whole seconds since `startedAt`, computed at request time. */
  uptimeSec: z.number(),
  // ISO 8601 UTC timestamp at the moment the server formed this response.
  // The dashboard uses it to compute clock skew against the server
  // (`offsetMs = Date.parse(serverNow) - clientNowAtFetch`) so time-range
  // filters anchor on the server's clock, not the user's laptop clock.
  serverNow: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * GET /api/health — unauthenticated liveness + version surface.
 *
 * The endpoint exposes only liveness and clock fields:
 * `status`, `name`, `version`, `startedAt`, `uptimeSec`, and
 * `serverNow` — nothing a network observer couldn't already derive
 * from the running socket.
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
