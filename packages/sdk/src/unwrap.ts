/**
 * `unwrap` / `unwrapOr` — turn hey-api's `{ data, error, response }` result
 * tuple into either the success payload or a normalised {@link GlyphError}.
 *
 * Pure data normalisation only: no retries, no auth, no logging. The
 * mapping from the glyph HTTP error envelope to `GlyphError` lives here so
 * every consumer treats failures identically.
 */

import { GlyphError, type GlyphIssue } from "./errors.js";

/** The subset of hey-api's result tuple these helpers depend on. */
export interface ResultLike<T> {
  readonly data?: T;
  readonly error?: unknown;
  // hey-api types `response` as optional: an error raised while building the
  // request, or a transport/network failure, can resolve with no response.
  readonly response?: Response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toIssues(raw: unknown): ReadonlyArray<GlyphIssue> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues: GlyphIssue[] = [];
  for (const item of raw) {
    if (isRecord(item) && typeof item.path === "string" && typeof item.message === "string") {
      issues.push({ path: item.path, message: item.message });
    }
  }
  return issues.length > 0 ? issues : undefined;
}

/**
 * Normalise a non-2xx response into a `GlyphError`:
 *   - `{ error, code: "ValidationError", issues }` → keeps code + issues,
 *   - `{ error, code? }`                           → keeps the message (+ code),
 *   - anything else (non-JSON / unrecognised body) → falls back to the
 *     response's status text.
 */
function toGlyphError(error: unknown, response: Response): GlyphError {
  if (isRecord(error) && typeof error.error === "string") {
    const code = typeof error.code === "string" ? error.code : undefined;
    return new GlyphError({
      status: response.status,
      code,
      message: error.error,
      issues: code === "ValidationError" ? toIssues(error.issues) : undefined,
      response,
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
  // A transport-level failure (offline, DNS, abort, request-build error) is
  // surfaced by hey-api as a thrown `Error` in the `error` slot, usually with
  // no `response` — re-throw it untouched rather than wrapping it.
  if (result.error instanceof Error) throw result.error;
  const { response } = result;
  if (!response) throw result.error ?? new Error("request did not complete");
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
