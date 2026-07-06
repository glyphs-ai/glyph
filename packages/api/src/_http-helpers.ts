/**
 * Shared OpenAPI wiring for route modules in the api layer.
 *
 * Every route module builds its sub-app with {@link createApiApp} so the
 * whole mount tree is `OpenAPIHono` and the assembled spec carries every
 * route. The factory installs a `defaultHook` that converts a failed zod
 * request validation into a structured 400 envelope — `{ error, code,
 * issues }` — consistent with the hand-rolled `{ error, code? }` envelope
 * that `respondError` produces for business errors.
 *
 * ## Why responses are declared the way they are
 *
 * Success responses carry the zod schema as their `content` so the
 * schema shows up in the spec (and is the documented response shape).
 * Error responses are declared WITHOUT `content` (description only).
 *
 * That contentless-error detail is load-bearing: `@hono/zod-openapi`
 * only switches a route's handler into "strict" return typing (where
 * the handler may return ONLY typed responses) when EVERY declared
 * response has `content`. Our handlers return business errors through
 * `respondError`, which yields a plain `Response` with a runtime-computed
 * status — not a statically-typed `TypedResponse`. Declaring at least
 * one contentless response keeps the handler return type permissive
 * (`... | Response`) so `respondError` stays valid without per-call-site
 * casts. Success-body shape is still locked: handlers annotate their
 * `c.json<Wire>(…)` payloads against the wire types, which the
 * wire-schema parity test pins to these very schemas.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";
import { ZodError } from "zod";

/**
 * Construct an `OpenAPIHono` sub-app with the shared validation hook.
 * The `Env` generic carries per-app `Variables` (e.g. the
 * workspace-scoped families' `WorkspaceVars`).
 */
export function createApiApp<E extends Env = Env>(): OpenAPIHono<E> {
  const app = new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: "request validation failed",
            code: "ValidationError",
            issues: result.error.issues.map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
          },
          400,
        );
      }
    },
  });
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      if (err.status === 400 && err.message === "Malformed JSON in request body") {
        return c.json(
          {
            error: "request validation failed",
            code: "ValidationError",
            issues: [{ path: "", message: err.message }],
          },
          400,
        );
      }
      return err.getResponse();
    }
    // Service-layer input-schema parse failures (a `Schema.parse(...)`
    // call in `WorkspaceService.register` / `open` etc.) surface here
    // as a thrown `ZodError`. Convert to the same `ValidationError`
    // envelope `defaultHook` produces so body validation and
    // service-input validation look identical on the wire.
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "request validation failed",
          code: "ValidationError",
          issues: err.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    throw err;
  });
  return app;
}

/**
 * A success response entry carrying a JSON body schema.
 * `responses: { 200: jsonResponse(FooSchema, "…") }`.
 */
export function jsonResponse(schema: ZodType, description: string) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/**
 * A JSON request-body entry for `createRoute({ request: { body } })`.
 * Pairs the zod schema with the `application/json` content type and marks
 * it required, so `@hono/zod-openapi` validates the body via the shared
 * `defaultHook` (a structured 400 envelope on failure) before the handler
 * runs, projects it into the OpenAPI `requestBody`, and types the
 * handler's `c.req.valid("json")`. Generic over the schema type so that
 * inference flows through to the validated body.
 */
export function jsonRequest<T extends ZodType>(schema: T, required = true) {
  return { required, content: { "application/json": { schema } } };
}

/**
 * A contentless (description-only) response entry — used for documented
 * error statuses. Keeping these without `content` is what holds the
 * route in permissive return-typing mode (see the module doc above).
 */
export function errorResponse(description: string) {
  return { description };
}

/** The assembled OpenAPI 3.1 document, as produced by `getOpenAPI31Document`. */
type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPI31Document"]>;
/** Config accepted by `getOpenAPI31Document` (openapi version + `info` block). */
// biome-ignore lint/correctness/noUnusedVariables: kept with OpenApiDocument for the document helper type pair.
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
 * mount-level concern resolved by `resolveWorkspaceMiddleware`, not a
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
