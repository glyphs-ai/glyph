/**
 * `unwrap` / `unwrapOr` — turn hey-api's `{ data, error, response }` result
 * tuple into either the success payload or a normalised {@link GlyphError}.
 *
 * Pure data normalisation only: no retries, no auth, no logging. The
 * mapping from the glyph HTTP error envelope to `GlyphError` lives here so
 * every consumer treats failures identically.
 */

import { GlyphError, type GlyphIssue, isProblem } from "./errors.js";

/** The subset of hey-api's result tuple these helpers depend on. */
export interface ResultLike<T> {
  readonly data?: T;
  readonly error?: unknown;
  // hey-api types `response` as optional: an error raised while building the
  // request, or a transport/network failure, can resolve with no response.
  readonly response?: Response;
}

function toIssues(raw: unknown): ReadonlyArray<GlyphIssue> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues: GlyphIssue[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { path?: unknown }).path === "string" &&
      typeof (item as { message?: unknown }).message === "string"
    ) {
      issues.push({
        path: (item as { path: string }).path,
        message: (item as { message: string }).message,
      });
    }
  }
  return issues.length > 0 ? issues : undefined;
}

/**
 * Normalise a non-2xx response into a `GlyphError`:
 *   - an RFC 9457 Problem body → message from `detail`, plus `code`,
 *     `issues` (for a `ValidationError`), and the decoded `body`,
 *   - anything else (non-JSON / unrecognised body) → falls back to the
 *     response's status text.
 */
function toGlyphError(error: unknown, response: Response): GlyphError {
  if (isProblem(error)) {
    return new GlyphError({
      status: response.status,
      code: error.code,
      message: error.detail,
      issues: error.code === "ValidationError" ? toIssues(error.issues) : undefined,
      response,
      body: error,
    });
  }
  return new GlyphError({
    status: response.status,
    message: response.statusText || "Request failed",
    response,
  });
}

/** Return the success payload, or throw a normalised {@link GlyphError}. */
export function unwrap<T>(result: ResultLike<T>): T {
  // Branch order matters:
  //   1. transport-level Error in `error` → re-throw untouched (no response)
  //   2. no `response` object             → request never completed; throw the original error
  //   3. `response.ok`                     → return the success payload
  //   4. non-2xx response                 → normalise the error envelope into a GlyphError
  //
  // A transport-level failure (offline, DNS, abort, request-build error) is
  // surfaced by hey-api as a thrown `Error` in the `error` slot, usually with
  // no `response`, so it must be caught before the `response`-based branches.
  if (result.error instanceof Error) throw result.error;
  const { response } = result;
  if (!response) throw result.error ?? new Error("request did not complete");
  // A 2xx with no body (204, or any `void`-typed route) leaves `data`
  // undefined; the generated operation types already model those routes as
  // returning `void`, so the `as T` stays honest for callers.
  if (response.ok) return result.data as T;
  throw toGlyphError(result.error, response);
}

/** Like {@link unwrap}, but returns `fallback` instead of throwing. */
export function unwrapOr<T, U>(result: ResultLike<T>, fallback: U): T | U {
  try {
    return unwrap(result);
  } catch {
    return fallback;
  }
}
