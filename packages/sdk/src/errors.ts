/**
 * `GlyphError` — the single error type every SDK call funnels through.
 *
 * `unwrap()` (see `./unwrap.ts`) builds it from the glyph HTTP error
 * envelope so callers get one uniform, typed failure regardless of which
 * route failed. It carries the decoded envelope fields plus the raw
 * `Response` for callers that still need headers / status text / the body.
 */

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
}

export class GlyphError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly issues: ReadonlyArray<GlyphIssue> | undefined;
  readonly response: Response;

  constructor(opts: GlyphErrorOptions) {
    super(opts.message);
    this.name = "GlyphError";
    this.status = opts.status;
    this.code = opts.code;
    this.issues = opts.issues;
    this.response = opts.response;

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
