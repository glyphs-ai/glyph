import type { CatalogModule } from "@glyphs-ai/catalog";
import type { Context } from "hono";

/**
 * Pulls the per-workspace `CatalogModule` off the Hono request context.
 * Set up by the workspace middleware (see `workspaceContextMiddleware`
 * in server `index.ts`).
 *
 * Tests can pass a `CatalogModule` directly instead of going through
 * the middleware chain — every `*Routes` factory accepts either form
 * via `resolveCatalog`.
 */
export type CatalogResolver = (c: Context) => CatalogModule;

export function resolveCatalog(arg: CatalogResolver | CatalogModule): CatalogResolver {
  return typeof arg === "function" ? (arg as CatalogResolver) : () => arg;
}
