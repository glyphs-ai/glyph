/**
 * CLI-side glue over `@glyphs-ai/sdk`.
 *
 * The generated SDK operations resolve to a `{ data, error, response, request }`
 * result tuple (they default to `throwOnError: false`). This module owns the
 * three pieces the CLI layers on top of that:
 *
 *  - {@link ApiError} — the CLI's HTTP error type. `output.ts` pattern-matches
 *    on `err.status` / `err.body` (the parsed error envelope: `code`,
 *    `transition`, the `EntryNotReadyError` reason tree, …), so the throw path
 *    must carry the full parsed body.
 *  - {@link unwrap} — turns a result tuple into the success payload or throws,
 *    pinning the exact status → message → body mapping and the
 *    transport-error passthrough the CLI's exit-code policy depends on. The
 *    SDK's own `unwrap`/`GlyphError` are deliberately NOT used: `GlyphError`
 *    drops the full error body the CLI renders.
 *  - {@link configureClient} — points the shared SDK `client` singleton at the
 *    resolved base URL and pins request serialization (URLSearchParams query
 *    encoding + a blanket `Accept: application/json`) so the wire stays
 *    byte-identical to the contract `dashboard` and `server` agree on.
 */

import { client } from "@glyphs-ai/sdk";

/**
 * Thrown when the server responds with a non-2xx / non-204 status.
 * `body` is the parsed response payload (JSON when the response was
 * `application/json`; raw text otherwise) so callers can pattern-match
 * on `body.code` / `body.error` from the standard error envelope.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
 * Turn a generated operation's result tuple into its success payload, or
 * throw — the return/throw contract the CLI's exit-code policy depends on:
 *
 *  - no `response` (fetch threw: ECONNREFUSED, DNS, abort) → rethrow the
 *    original transport error so `formatError` maps it to exit code 3;
 *  - `response.ok` → return `data` (the parsed JSON body; `{}` for a 204);
 *  - otherwise → throw {@link ApiError} carrying the status and the full
 *    parsed error body, with the same message derivation the CLI shows
 *    today (`body.error` when it's a string, else `HTTP <status>`).
 */
export function unwrap<T>(result: SdkResult<T>): NonNullable<T> {
  const { response, error } = result;
  if (!response) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (response.ok) {
    return result.data as NonNullable<T>;
  }
  const message =
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof (error as { error: unknown }).error === "string"
      ? (error as { error: string }).error
      : `HTTP ${response.status}`;
  throw new ApiError(response.status, message, error);
}

/**
 * Query serializer pinning `URLSearchParams` encoding (spaces → `+`),
 * keeping query strings byte-identical to the wire contract. hey-api's
 * default serializer uses `encodeURIComponent` (spaces → `%20`), which would
 * diverge on free-text params such as `glyph workflow list -q "foo bar"`.
 * Skips `undefined` / `null` and stringifies primitives.
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
 * Handle returned by {@link configureClient}: the resolved base URL.
 * `baseUrl` is needed by the SSE path in `commands/task.ts` (raw
 * streaming, which the SDK does not cover). The typed SDK operations
 * use the shared `client` singleton configured by {@link configureClient}
 * directly — no escape hatch needed.
 */
export interface SdkClient {
  readonly baseUrl: string;
}

/**
 * Point the shared SDK `client` singleton at `baseUrl` and pin serialization
 * to be wire-compatible with the former hand-rolled client:
 *  - `Accept: application/json` on every request (merged over the SDK's
 *    default `Content-Type: application/json`, which the SDK drops on
 *    body-less requests — so GETs send only `Accept`, body-bearing requests
 *    send both, exactly as before);
 *  - the URLSearchParams-style {@link querySerializer}.
 *
 * `fetch` is deliberately left unset so the SDK resolves `globalThis.fetch`
 * at call time (the test suite spies on it). Trailing slashes are stripped
 * to match the former client's base-URL normalization.
 */
export function configureClient(baseUrl: string): SdkClient {
  const normalized = baseUrl.replace(/\/+$/, "");
  client.setConfig({
    baseUrl: normalized,
    headers: { Accept: "application/json" },
    querySerializer,
  });
  return { baseUrl: normalized };
}
