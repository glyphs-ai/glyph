import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "../_http-helpers.js";

/**
 * Wire schema + inferred type for `GET /api/config`. Single source of truth
 * for the OpenAPI projection and the response body's compile-time shape.
 *
 * Sourcing these from the server (rather than hardcoding the defaults in
 * dashboard copy) means the UI tells the user the truth even when an env
 * override like `GLYPH_HOME` is in effect. Sensitive values are NOT exposed:
 * the dashboard runs single-user on the same host, so absolute paths are fine.
 */
export const ServerConfigSchema = z.object({
  /** User-level glyph root (resolves `GLYPH_HOME`). */
  glyphHome: z.string(),
  // Currently-selected workspace id (UUID) from the registry, or null. A hint
  // for the dashboard's "open this workspace on first load" UX, not binding.
  currentWorkspaceId: z.string().nullable(),
  /** Host the server is bound to (e.g. `127.0.0.1` or `0.0.0.0`). */
  host: z.string(),
  /** Port the server is listening on. */
  port: z.number(),
  /** Native path separator on the server's OS (`\\` on Windows, `/` elsewhere). */
  pathSeparator: z.string(),
  /** Tunables consumed by the dashboard's task list view. */
  tasks: z.object({
    // How often the dashboard re-fetches the task list while any task is
    // non-terminal. Server-owned so it can be tuned without a new dashboard
    // build (and so a UX-shaping constant doesn't live inside React).
    pollIntervalMs: z.number(),
  }),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * GET /api/config — returns the resolved server config. The deps are read
 * fresh on each request so dynamic fields (currently `currentWorkspaceId`)
 * stay accurate as the registry mutates.
 */
export function configRoutes(deps: {
  glyphHome: string;
  host: string;
  port: number;
  pathSeparator: string;
  currentWorkspaceId: () => Promise<string | null> | string | null;
  /**
   * Optional override for the dashboard task-list poll cadence. Defaults
   * to 4000 ms — chosen as a tradeoff between snappiness and server load
   * (TaskModule.listTasks.execute() runs an indexed SELECT on every call). Operators
   * can lower this for faster UI feedback at the cost of more reads,
   * or raise it for very large workspaces.
   */
  taskPollIntervalMs?: number;
}): OpenAPIHono {
  const app = createApiApp();
  const taskPollIntervalMs = deps.taskPollIntervalMs ?? 4000;

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["system"],
      summary: "Resolved server configuration",
      responses: {
        200: jsonResponse(ServerConfigSchema, "Resolved server config"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) =>
      c.json<ServerConfig>({
        glyphHome: deps.glyphHome,
        currentWorkspaceId: await deps.currentWorkspaceId(),
        host: deps.host,
        port: deps.port,
        pathSeparator: deps.pathSeparator,
        tasks: { pollIntervalMs: taskPollIntervalMs },
      }),
  );

  return app;
}
