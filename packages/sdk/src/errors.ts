/**
 * `GlyphError` — the single error type every SDK call funnels through.
 *
 * `unwrap()` builds it from the `application/problem+json` Problem
 * envelope so callers get one uniform, typed failure regardless of which
 * route failed. It carries the decoded `Problem` body plus the raw
 * `Response` for callers that still need headers / status text / the body.
 */

import type { Problem } from "./generated/types.gen.js";

export type { Problem } from "./generated/types.gen.js";

/** A single field-level validation problem from a `ValidationError` 400. */
export interface GlyphIssue {
  readonly path: string;
  readonly message: string;
}

export interface GlyphErrorOptions {
  readonly status: number;
  readonly code?: string | undefined;
  readonly message: string;
  readonly issues?: ReadonlyArray<GlyphIssue> | undefined;
  readonly response: Response;
  /** The decoded `application/problem+json` Problem body, when the error carried one. */
  readonly body?: Problem | undefined;
}

export class GlyphError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly issues: ReadonlyArray<GlyphIssue> | undefined;
  readonly response: Response;
  /**
   * The decoded Problem body when the failure carried an
   * `application/problem+json` envelope (extension members like `agent`,
   * `reason`, `transition`, `fromStatus`, `field` live here). `undefined`
   * for transport failures / non-Problem bodies.
   */
  readonly body: Problem | undefined;

  constructor(opts: GlyphErrorOptions) {
    super(opts.message);
    this.name = "GlyphError";
    this.status = opts.status;
    this.code = opts.code;
    this.issues = opts.issues;
    this.response = opts.response;
    this.body = opts.body;

    // Drop this constructor frame from the stack so the top frame is the
    // throwing call site. `captureStackTrace` is V8-only (undefined in
    // browsers); the typeof guard makes it a safe no-op elsewhere.
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, GlyphError);
    }
  }
}

export function isGlyphError(err: unknown): err is GlyphError {
  return err instanceof GlyphError;
}

/**
 * Structural guard for a decoded `application/problem+json` Problem body. Checks the five
 * required core members (`type` / `title` / `status` / `detail` / `code`)
 * so a parsed `application/problem+json` response body narrows to
 * {@link Problem} before its extension members are read.
 */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "number" &&
    typeof v.detail === "string" &&
    typeof v.code === "string"
  );
}

/**
 * Decode an `application/problem+json` Problem body from a raw {@link Response}, for callers
 * holding a `Response` rather than the SDK's pre-parsed `error` slot (e.g.
 * the dashboard's hand-rolled `fetch` helpers). Returns the typed
 * {@link Problem} only when the response is labelled
 * `application/problem+json` and the body validates via {@link isProblem};
 * otherwise `undefined` — so a non-Problem body (a plain-`application/json`
 * envelope, a `text/*` error page, or a malformed reply) never throws
 * inside an error path.
 *
 * The content-type guard means bodies the server did NOT tag as Problem
 * details (e.g. a 202 warming envelope) are left unread, so the caller can
 * still consume them itself. When the guard passes, the body IS consumed —
 * call this at most once per response.
 */
export async function parseProblem(res: Response): Promise<Problem | undefined> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/problem+json")) return undefined;
  try {
    const body: unknown = await res.json();
    return isProblem(body) ? body : undefined;
  } catch {
    return undefined;
  }
}
