/**
 * Global / unauthenticated routes: server health, resolved server
 * config, and the runtime capability list. None of these are
 * workspace-scoped and none declare a request body, so the module
 * holds only the manifest slice.
 */

import type { HealthResponse } from "../health.js";
import type { RuntimeInfo } from "../runtimes.js";
import type { ServerConfig } from "../server-config.js";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";

export const systemRoutes = {
  "health.get": defineRoute<Record<string, never>, HealthResponse>("GET", "/api/health"),
  "config.get": defineRoute<Record<string, never>, ServerConfig>("GET", "/api/config"),
  /**
   * Returns each registered runtime's kind + capability bag so
   * dashboard / CLI can branch on capability flags
   * (e.g. `capabilities.remoteSession`).
   */
  "runtimes.list": defineRoute<Record<string, never>, readonly RuntimeInfo[]>(
    "GET",
    "/api/runtimes",
  ),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
