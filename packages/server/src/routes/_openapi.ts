/**
 * OpenAPI wiring for server route modules.
 *
 * The core route helpers (`createApiApp`, `jsonRequest`, `jsonResponse`,
 * `errorResponse`) live in `@glyphs-ai/api` and are re-exported here so
 * existing server route files compile unchanged. The server-specific
 * helpers (`injectWorkspaceIdParam`, `registerOpenApiDoc`) remain local —
 * they assemble the served OpenAPI document, a transport concern.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "hono";

export { createApiApp, errorResponse, jsonRequest, jsonResponse } from "@glyphs-ai/api";

/** The assembled OpenAPI 3.1 document, as produced by `getOpenAPI31Document`. */
type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPI31Document"]>;
/** Config accepted by `getOpenAPI31Document` (openapi version + `info` block). */
type OpenApiDocumentConfig = Parameters<OpenAPIHono["getOpenAPI31Document"]>[0];

const OPENAPI_HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Inject the workspace `id` path parameter into every operation mounted
 * under `/api/workspaces/{id}/...`.
 *
 * Workspace-nested route families are mounted on the `/:id` prefix in
 * `server/src/index.ts` (mirrored by the codegen and snapshot assemblies),
 * so `@hono/zod-openapi` composes `{id}` into each operation's path
 * template. The leaf `createRoute`s never declare `id` though: it is a
 * mount-level concern resolved by `workspaceContextMiddleware`, not a
 * per-route validated param. The generated document would therefore carry
 * a path-template variable with no matching parameter — invalid OpenAPI
 * that also leaves the generated SDK unable to substitute the workspace
 * id. This post-processing pass adds the missing required `id` path
 * parameter to those operations. The top-level `/api/workspaces/{id}`
 * resource already declares `id` and is left untouched.
 */
export function injectWorkspaceIdParam(doc: OpenApiDocument): OpenApiDocument {
  const paths = doc.paths;
  if (!paths) return doc;
  for (const [path, item] of Object.entries(paths)) {
    if (!item || !path.startsWith("/api/workspaces/{id}/")) continue;
    for (const method of OPENAPI_HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = op.parameters ?? [];
      if (params.some((p) => "in" in p && p.in === "path" && p.name === "id")) continue;
      op.parameters = [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        ...params,
      ];
    }
  }
  return doc;
}

/**
 * Assemble the OpenAPI 3.1 document, inject the mount-level workspace `id`
 * params (see {@link injectWorkspaceIdParam}), and serve the result as a
 * static JSON route. Used in place of `app.doc31(...)` so the served spec,
 * the snapshot, and the generated SDK all agree on the `id` parameter.
 */
export function registerOpenApiDoc<E extends Env>(
  app: OpenAPIHono<E>,
  path: string,
  config: OpenApiDocumentConfig,
): void {
  const doc = injectWorkspaceIdParam(app.getOpenAPI31Document(config));
  app.get(path, (c) => c.json(doc));
}
