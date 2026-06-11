/**
 * Flat-enumeration helper over the shipped HTTP API surface.
 *
 * Lives in `@glyphs-ai/api` (not `@glyphs-ai/contracts`) because the
 * single consumer is the server-side reflection test
 * (`packages/server/test/route-manifest.test.ts`), which already
 * imports through the api barrel. Keeping it here trims one symbol
 * off the contracts public surface; the contracts pkg still owns the
 * canonical {@link ROUTES} declaration that this helper iterates.
 *
 * External tooling (docs generators, OpenAPI exporters, MCP wrappers)
 * that wants the inventory should import it via
 * `import { listRoutes } from "@glyphs-ai/api"`.
 */

import { type HttpMethod, ROUTES, type RouteKey } from "@glyphs-ai/contracts";

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
