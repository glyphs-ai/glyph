/**
 * Shared OpenAPI wiring for `packages/server/src/routes/**`.
 *
 * Every route module builds its sub-app with {@link createApiApp} so the
 * whole mount tree is `OpenAPIHono` and the assembled spec
 * (`GET /api/openapi.json`) carries every route. The factory installs a
 * `defaultHook` that converts a failed zod request validation into a
 * structured 400 envelope — `{ error, code, issues }` — consistent with
 * the hand-rolled `{ error, code? }` envelope that `respondError`
 * produces for business errors.
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
 * `c.json<Wire>(…)` payloads against the `@glyphs-ai/contracts` types,
 * which the wire-schema parity test pins to these very schemas.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "hono";
import type { ZodType } from "zod";

/**
 * Construct an `OpenAPIHono` sub-app with the shared validation hook.
 * The `Env` generic carries per-app `Variables` (e.g. the
 * workspace-scoped families' `WorkspaceVars`).
 */
export function createApiApp<E extends Env = Env>(): OpenAPIHono<E> {
  return new OpenAPIHono<E>({
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
 * A contentless (description-only) response entry — used for documented
 * error statuses. Keeping these without `content` is what holds the
 * route in permissive return-typing mode (see the module doc above).
 */
export function errorResponse(description: string) {
  return { description };
}
