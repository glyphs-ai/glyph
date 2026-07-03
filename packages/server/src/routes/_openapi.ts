/**
 * OpenAPI document serving — the server transport concern.
 *
 * All OpenAPI is DEFINED in `@glyphs-ai/api`: the route helpers
 * (`createApiApp`, `jsonRequest`, `jsonResponse`, `errorResponse`) and the
 * spec post-processor `injectWorkspaceIdParam`. This module keeps only the
 * transport step — assembling the served document from the mounted app and
 * exposing it as a static JSON route.
 */
import { injectWorkspaceIdParam } from "@glyphs-ai/api";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "hono";

export { createApiApp } from "@glyphs-ai/api";

/** Config accepted by `getOpenAPI31Document` (openapi version + `info` block). */
type OpenApiDocumentConfig = Parameters<OpenAPIHono["getOpenAPI31Document"]>[0];

/**
 * Assemble the OpenAPI 3.1 document, inject the mount-level workspace `id`
 * params (see `injectWorkspaceIdParam` in `@glyphs-ai/api`), and serve the
 * result as a static JSON route. Used in place of `app.doc31(...)` so the
 * served spec, the snapshot, and the generated SDK all agree on the `id`
 * parameter.
 */
export function registerOpenApiDoc<E extends Env>(
  app: OpenAPIHono<E>,
  path: string,
  config: OpenApiDocumentConfig,
): void {
  const doc = injectWorkspaceIdParam(app.getOpenAPI31Document(config));
  app.get(path, (c) => c.json(doc));
}
