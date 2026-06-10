import type { ServerConfig } from "@glyphs-ai/api";
import { Hono } from "hono";

/**
 * GET /api/config — returns the resolved server config. The deps are read
 * fresh on each request so dynamic fields (currently `currentWorkspaceId`)
 * stay accurate as the registry mutates.
 *
 * The `ServerConfig` wire shape lives in `@glyphs-ai/contracts`
 * (re-exported via `@glyphs-ai/api`) so the dashboard and CLI can
 * typecheck against it without value-importing `@glyphs-ai/server`.
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
   * (TaskService.list() runs an indexed SELECT on every call). Operators
   * can lower this for faster UI feedback at the cost of more reads,
   * or raise it for very large workspaces.
   */
  taskPollIntervalMs?: number;
}): Hono {
  const app = new Hono();
  const taskPollIntervalMs = deps.taskPollIntervalMs ?? 4000;
  app.get("/", async (c) =>
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
