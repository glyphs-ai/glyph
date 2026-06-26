/**
 * Flat-enumeration helper over the shipped HTTP API surface.
 *
 * The single consumer is the server-side reflection test
 * (`packages/server/test/route-manifest.test.ts`), which imports it
 * through the api barrel. The canonical {@link ROUTES} declaration
 * this helper iterates lives alongside it under `./wire`.
 *
 * External tooling (docs generators, OpenAPI exporters, MCP wrappers)
 * that wants the inventory should import it via
 * `import { listRoutes } from "@glyphs-ai/api"`.
 */

import { type HttpMethod, ROUTES, type RouteKey } from "./wire/index.js";

/**
 * Flat enumeration of `{ method, path }` pairs for every entry in
 * {@link ROUTES}. The reflection test in
 * `packages/server/test/route-manifest.test.ts` uses this to compare
 * against `app.routes` (the side-effect registry Hono keeps after
 * `.get` / `.post` / ...) and refuses any mismatch.
 */
export function listRoutes(): readonly { readonly method: HttpMethod; readonly path: string }[] {
  return (Object.keys(ROUTES) as RouteKey[]).map((k) => {
    const r = ROUTES[k];
    return { method: r.method, path: r.path };
  });
}
