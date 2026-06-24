/**
 * Compile-time response-body lock for route handlers.
 *
 * Handlers import their *request* types from the `@glyphs-ai/contracts`
 * manifest, but they used to construct *response* payloads ad hoc — so a
 * handler returning the wrong success shape compiled cleanly and the
 * drift only surfaced (if at all) in a downstream consumer. This wrapper
 * closes that gap.
 *
 * `defineHandler(routeKey, fn)` ties the handler's success return value
 * to `RouteRes<typeof ROUTES[routeKey]>` — the response-body type
 * declared once in the manifest. Returning a payload that doesn't match
 * that shape fails `tsc` instead of slipping onto the wire.
 *
 * The callback returns ONE of:
 *   - the success body, typed as `RouteRes<typeof ROUTES[K]>` — the
 *     wrapper serialises it with `c.json(body, opts.status)`;
 *   - `undefined` (the only inhabitant a `void`-bodied route can return)
 *     — the wrapper replies `204 No Content`;
 *   - a ready-made `Response` — forwarded verbatim. This is the escape
 *     hatch for the paths intentionally outside the typed success
 *     contract: `respondError`, inline `c.json({ error }, 4xx)`
 *     validation replies, `c.body(null, 204)`, and the binary / SSE
 *     routes whose body is not JSON.
 *
 * Only the success-body branch is compile-locked; error envelopes stay
 * opaque `Response`s, matching the existing `respondError` convention.
 */

// biome-ignore lint/style/useImportType: ROUTES is read in the `typeof ROUTES` type query below, which needs a value binding (an `import type` would make it unusable as a value).
import { ROUTES, type RouteKey, type RouteRes } from "@glyphs-ai/api";
import type { Context, Handler } from "hono";
import type { BlankEnv } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Success-body type a handler for route `K` must return. */
export type RouteResponseBody<K extends RouteKey> = RouteRes<(typeof ROUTES)[K]>;

/**
 * Context type handed to a {@link defineHandler} callback.
 *
 * Hono infers tight path-param types only for a handler literal passed
 * straight to `app.METHOD(path, literal)`; routing the literal through a
 * wrapper widens `c.req.param("id")` to `string | undefined`. The synthetic
 * path below re-asserts every path-param name this server registers as a
 * present `string`, restoring the typing handlers had before the wrap. A
 * handler only reads the params its own route declares, so the
 * over-approximation is sound in practice; query params remain
 * `string | undefined`.
 */
type RouteContext = Context<
  BlankEnv,
  "/:id/:sid/:tid/:nid/:wfid/:name/:from/:to/:path/:encodedPath"
>;

/**
 * What a {@link defineHandler} callback may return: the route's typed
 * success body, or a pre-built {@link Response} for the non-JSON / error
 * / early-return paths.
 */
export type HandlerResult<K extends RouteKey> = RouteResponseBody<K> | Response;

export interface DefineHandlerOpts<K extends RouteKey> {
  /**
   * HTTP status for the success-body branch. Defaults to 200; pass 201
   * for resource-creation routes. May also be a function of the (already
   * type-locked) body — used by the catalog install / sync routes, which
   * reply 207 Multi-Status when the result carries partial failures and
   * 200/201 otherwise. Error responses carry their own status on the
   * {@link Response} they return.
   */
  readonly status?: ContentfulStatusCode | ((body: RouteResponseBody<K>) => ContentfulStatusCode);
}

/**
 * Wrap a route handler so its success return is checked against the
 * manifest's `RouteRes<typeof ROUTES[route]>`. `route` is consumed only
 * at the type level to infer `K`; the wrapper does not read it at
 * runtime.
 */
export function defineHandler<K extends RouteKey>(
  route: K,
  fn: (c: RouteContext) => HandlerResult<K> | Promise<HandlerResult<K>>,
  opts: DefineHandlerOpts<K> = {},
): Handler {
  void route;
  return async (c) => {
    const result: unknown = await fn(c);
    if (result instanceof Response) return result;
    // `void`-bodied routes signal "no content" by returning nothing.
    if (result === undefined) return c.body(null, 204);
    // The success shape is already enforced at the `fn` boundary above;
    // this cast only widens the otherwise-opaque generic body to the
    // shallow `object` type Hono's `c.json` accepts (a concrete
    // `RouteRes<K>` would force Hono to recurse into `JSONParsed` and
    // trip TS2589 "excessively deep").
    const status =
      typeof opts.status === "function"
        ? opts.status(result as RouteResponseBody<K>)
        : (opts.status ?? 200);
    return c.json(result as object, status);
  };
}
