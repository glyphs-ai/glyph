import type { RuntimeInfo } from "@glyphs-ai/api";
import { RuntimeInfoSchema } from "@glyphs-ai/api";
import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "./_openapi.js";

/**
 * Routes for /api/runtimes — exposes the registered runtime kinds AND
 * each runtime's advertised capability flags so clients can
 * conditionally enable UI affordances (e.g. a "Spawn remote"
 * button only renders enabled when the active runtime sets
 * `capabilities.remoteSession === true`).
 *
 * The `RuntimeInfo` wire shape lives in `@glyphs-ai/contracts`
 * (re-exported via `@glyphs-ai/api`) so dashboard / CLI consumers can
 * typecheck against it without value-importing `@glyphs-ai/server`.
 */
export function runtimesRoutes(registry: RuntimeRegistry): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["system"],
      summary: "Registered runtime kinds + capabilities",
      responses: {
        200: jsonResponse(RuntimeInfoSchema.array(), "Registered runtimes"),
        500: errorResponse("Internal error"),
      },
    }),
    (c) => {
      const out: RuntimeInfo[] = registry.kinds().map((kind) => {
        const rt = registry.get(kind);
        return {
          kind,
          capabilities: { ...(rt.capabilities ?? {}) },
        };
      });
      return c.json(out);
    },
  );

  return app;
}
