/**
 * Facade for the glyph HTTP API surface — the single source of truth
 * for every route.
 *
 * Each route is declared once as a {@link RouteSpec} (in the per-domain
 * modules under `./routes/`), carrying:
 *  - `method` and `path` — used at server-boot to mount the Hono handler
 *    and at CLI/MCP-call to construct the URL
 *  - **phantom** request and response types — `RouteSpec<Req, Res>`
 *    parametrises the spec with the wire shapes so consumers (server
 *    handler and CLI client) can type-check against the same contract
 *
 * This facade re-exports the route-spec primitives ({@link RouteSpec},
 * {@link defineRoute}, …) and every per-domain request/response body
 * type, then composes the per-domain manifest slices into the single
 * {@link ROUTES} registry that consumers import. Per the facade +
 * sibling-subdir split convention (`docs/pkg-template.md`), the
 * per-domain modules under `./routes/` are package-private; this file
 * is their only public entry.
 *
 * **Drift protection** comes from two complementary mechanisms:
 *  1. The reflection test in `packages/server/test/route-manifest.test.ts`
 *     asserts that every Hono-registered route equals exactly one
 *     {@link ROUTES} entry — adding a route without updating the manifest
 *     (or vice versa) fails CI.
 *  2. The CLI's `ApiClient.call(key, opts)` is generic over `keyof ROUTES`
 *     — `key` autocompletes from the manifest, `opts.body` is typed by the
 *     route's request body type, and the return value is typed by the
 *     response type. CLI calls cannot reference a route that doesn't
 *     exist in the manifest, and a request body that doesn't match the
 *     declared shape fails to compile.
 *
 * Server-side response-body drift is not compile-locked yet; see
 * https://github.com/glyphs-ai/glyph/issues/89.
 */

import type { RouteRequest, RouteSpec } from "./routes/_spec.js";
import { catalogRoutes } from "./routes/catalog.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { sessionRoutes } from "./routes/sessions.js";
import { systemRoutes } from "./routes/system.js";
import { taskRoutes } from "./routes/tasks.js";
import { workflowRoutes } from "./routes/workflows.js";
import { workspaceRoutes } from "./routes/workspaces.js";

export type { HttpMethod, RouteReq, RouteRequest, RouteRes, RouteSpec } from "./routes/_spec.js";
export { defineRoute } from "./routes/_spec.js";
export type * from "./routes/catalog.js";
export type * from "./routes/schedules.js";
export type * from "./routes/sessions.js";
export type * from "./routes/tasks.js";
export type * from "./routes/workflows.js";
export type * from "./routes/workspaces.js";

// ──────────────────────────────────────────────────────────────────────
// ROUTES — the manifest. Each domain module owns its slice; the facade
// composes them into the single registry. Add a route in the matching
// slice AND in the matching handler; the reflection test enforces the
// bijection. Keys are dot-separated resource scopes with the action verb
// as the final segment.
// ──────────────────────────────────────────────────────────────────────

export const ROUTES = {
  ...systemRoutes,
  ...workspaceRoutes,
  ...sessionRoutes,
  ...taskRoutes,
  ...scheduleRoutes,
  ...workflowRoutes,
  ...catalogRoutes,
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;

/** Union of every key in {@link ROUTES}. Use as the generic param of `ApiClient.call`. */
export type RouteKey = keyof typeof ROUTES;
