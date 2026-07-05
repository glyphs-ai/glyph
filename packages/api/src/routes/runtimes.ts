import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "../_http-helpers.js";

/**
 * Wire schema + inferred type for `GET /api/runtimes`. Single source of truth
 * for the OpenAPI projection and the response body's compile-time shape.
 *
 * `capabilities` is pass-through from `Runtime.capabilities`; an empty object
 * `{}` means the runtime made no opt-in claims (absence of a flag ===
 * unsupported, not unknown).
 */
export const RuntimeInfoSchema = z.object({
  kind: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
});
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

/**
 * Routes for /api/runtimes — exposes the registered runtime kinds AND
 * each runtime's advertised capability flags so clients can
 * conditionally enable UI affordances (e.g. a "Spawn remote"
 * button only renders enabled when the active runtime sets
 * `capabilities.remoteSession === true`).
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
        // `kind` came from `kinds()`, so the lookup is always present.
        const rt = registry.get(kind)._unsafeUnwrap();
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
