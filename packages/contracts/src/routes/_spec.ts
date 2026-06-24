/**
 * Route-spec primitives shared by every route-domain module in this
 * subdir and re-exported from the `../routes.ts` facade.
 *
 * A single {@link RouteSpec} declaration drives both the server
 * handler's request typing and the CLI / dashboard client's
 * request + response typing via `typeof ROUTES[K]` lookups.
 * {@link defineRoute} is the only runtime value here; everything else
 * is a type erased at build time.
 *
 * Lives behind a leading underscore (package-private shared
 * infrastructure, not a route-domain peer) so the facade-split
 * structural test treats it as an ordinary helper module rather than a
 * concern file.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Per-route request shape. Each field is optional so callers can declare
 * only what the route actually accepts:
 *
 *  - `body`   — JSON body (POST / PUT / PATCH). Undefined for GET / DELETE.
 *  - `query`  — query-string parameters. Each value is sent as a string;
 *               handlers parse / validate.
 *  - `params` — path placeholders. Keys MUST match every `:name` token in
 *               the route's `path` string; the CLI client substitutes them
 *               in URL construction.
 */
export interface RouteRequest {
  readonly body?: unknown;
  readonly query?: unknown;
  readonly params?: unknown;
}

/**
 * Compile-time contract for one HTTP route. The `_req` and `_res` fields
 * are phantom — never assigned, never read; they exist solely to carry
 * the type parameters through `typeof ROUTES[K]` lookups so consumers
 * can write `RouteReq<typeof ROUTES["..."]>` and get the right shape.
 */
export interface RouteSpec<Req extends RouteRequest = Record<string, never>, Res = unknown> {
  readonly method: HttpMethod;
  readonly path: string;
  /** Phantom; never read at runtime. */
  readonly _req: Req;
  /** Phantom; never read at runtime. */
  readonly _res: Res;
}

/**
 * Construct a typed {@link RouteSpec}. The `_req` and `_res` slots are
 * filled with runtime placeholders. The values are never read, but
 * TypeScript needs the properties to exist for generic inference to
 * flow through `typeof ROUTES[K]`.
 */
export function defineRoute<Req extends RouteRequest = Record<string, never>, Res = unknown>(
  method: HttpMethod,
  path: string,
): RouteSpec<Req, Res> {
  const phantom = undefined as never;
  return { method, path, _req: phantom, _res: phantom };
}

/** Extract the request shape carried by a {@link RouteSpec}. */
export type RouteReq<R> = R extends RouteSpec<infer Req, unknown> ? Req : never;
/** Extract the response shape carried by a {@link RouteSpec}. */
export type RouteRes<R> = R extends RouteSpec<RouteRequest, infer Res> ? Res : never;
