/**
 * Dashboard-side glue over `@glyphs-ai/sdk`.
 *
 * The generated SDK operations resolve to a `{ data, error, response, request }`
 * result tuple (they default to `throwOnError: false`). This module owns the
 * two pieces the dashboard layers on top of that:
 *
 *  - {@link configureSdkClient} — points the shared SDK `client` singleton at
 *    same-origin (relative) URLs and pins query serialization to the
 *    `URLSearchParams` encoding the former hand-rolled client used, so the
 *    wire stays byte-identical to what the `server` and `cli` agree on.
 *    `fetch` is deliberately left unset so the SDK resolves
 *    `globalThis.fetch` at call time — the test suite swaps that global.
 *  - {@link unwrap} — turns a result tuple into the success payload or throws
 *    the dashboard's {@link ApiError}, mirroring `http.ts`'s error semantics:
 *    the `application/problem+json` Problem envelope (`detail` → message,
 *    plus `code` / `field`),
 *    the 202 "warming" surface (`code: "WorkspaceWarming"`), and the
 *    transport-error passthrough.
 *
 * The SDK's own `unwrap` / `GlyphError` are intentionally NOT used: the
 * dashboard's UI surfaces branch on `ApiError.code` / `.field` / `.status`,
 * which `GlyphError` does not carry in the shape they expect.
 */

import { client, isProblem } from "@glyphs-ai/sdk";
import { ApiError, getActiveWorkspace } from "./http.js";

/**
 * The result shape every generated operation resolves to when
 * `throwOnError` is false (the SDK default). Mirrors hey-api's
 * `RequestResult` structurally without depending on its internal generics.
 */
export interface SdkResult<T> {
  readonly data?: T;
  readonly error?: unknown;
  readonly response?: Response;
  readonly request?: Request;
}

/**
 * Query serializer pinning `URLSearchParams` encoding (spaces → `+`, `:` →
 * `%3A`), keeping query strings byte-identical to the former hand-rolled
 * client. Skips `undefined` / `null` and stringifies primitives so only
 * the keys a caller actually set appear on the wire.
 */
function querySerializer(query: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    usp.append(name, String(value));
  }
  return usp.toString();
}

/**
 * Point the shared SDK `client` at same-origin relative URLs (no `baseUrl`,
 * so requests stay `/api/...` exactly as the dashboard issued them before)
 * and install the {@link querySerializer}. Idempotent; run once at module
 * load below so every adapter shares one configured client.
 */
export function configureSdkClient(): void {
  client.setConfig({ querySerializer });
}

// The dashboard has no single bootstrap seam (adapters are imported ad hoc
// by components and tests), and every adapter imports `unwrap` from this
// module — so configuring the shared client here, at first import, is the
// one place guaranteed to run before any generated operation is called.
configureSdkClient();

/**
 * Build (do NOT throw) an {@link ApiError} from a server error body,
 * mirroring `http.ts`'s `buildApiError`: the `application/problem+json` Problem envelope
 * (`{ type, title, status, detail, code, field?, ... }`) maps `detail` →
 * message and carries `code` / `field`; the 202 `{ state: "warming",
 * workspaceId }` surface becomes `code: "WorkspaceWarming"`.
 */
function buildApiError(status: number, body: unknown): ApiError {
  // hey-api decodes the `application/problem+json` error body into `body`;
  // narrow it to the typed Problem so the user-visible message is the
  // server's `detail`, not the bare status.
  if (isProblem(body)) {
    return new ApiError(body.detail, {
      status,
      code: body.code,
      ...(typeof body.field === "string" ? { field: body.field } : {}),
    });
  }
  // The 202 warming envelope ({state, workspaceId}) is the one non-Problem
  // error body; it rides in `data` (202 is response.ok).
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.state === "warming" && typeof b.workspaceId === "string") {
      return new ApiError(`workspace "${b.workspaceId}" is warming up`, {
        status,
        code: "WorkspaceWarming",
      });
    }
  }
  return new ApiError(`${status}`, { status });
}

/**
 * Turn a generated operation's result tuple into its success payload, or
 * throw — reproducing the former `http.ts` helpers' contract:
 *
 *  - no `response` (fetch threw: the test stub, an abort, a network error) →
 *    rethrow the original transport error unchanged;
 *  - `status === 202` → the per-workspace context is warming; the warming
 *    envelope rides in `data` (202 is `response.ok`), surfaced as an
 *    {@link ApiError} with `code: "WorkspaceWarming"`;
 *  - any other non-OK → {@link ApiError} carrying the status + parsed error
 *    body (which the SDK puts in `error`);
 *  - OK → return `data` (the parsed JSON body; `{}` for a 204).
 */
export function unwrap<T>(result: SdkResult<T>): T {
  const { response, error, data } = result;
  if (!response) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (response.status === 202) {
    throw buildApiError(202, data);
  }
  if (!response.ok) {
    throw buildApiError(response.status, error);
  }
  return data as T;
}

/**
 * Resolve the workspace currently in scope for the active route, or throw
 * the same `"no workspace selected"` error the former `workspacePrefix()`
 * raised. Generated workspace-scoped operations take the middleware-injected
 * `{id}` as an explicit typed `path` param, so adapters pass this through
 * rather than threading a workspace argument down every signature.
 */
export function requireWorkspaceId(): string {
  const id = getActiveWorkspace();
  if (!id) {
    throw new Error("no workspace selected");
  }
  return id;
}
