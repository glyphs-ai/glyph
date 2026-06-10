import { CatalogError } from "../errors.js";

/**
 * Error types thrown by the `src/fetcher/` subdir. Re-exported from
 * the package barrel (`src/index.ts`) so consumers don't reach across
 * subdir boundaries to construct them. The fetcher subdir intentionally
 * doesn't import from sibling subdirs — it's the catalog's bytes-on-disk
 * layer, with no knowledge of frontmatter, scope, identity, or deps.
 */

export class FetcherError extends CatalogError {
  override readonly name: string = "FetcherError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Origin URI failed to parse. Surfaces the raw URI plus the reason so the
 * dashboard / CLI can echo it back to the user without exposing internal
 * paths. Supported origins are GitHub tree URLs, Azure DevOps Services
 * item URLs, and `file:<absolutePath>`.
 */
export class OriginParseError extends FetcherError {
  override readonly name = "OriginParseError";

  constructor(
    public readonly origin: string,
    public readonly reason: string,
  ) {
    super(`invalid origin "${origin}": ${reason}`);
  }
}

/**
 * A {@link Fetcher} failed to materialize an origin's contents. Wraps the
 * underlying cause (network error, HTTP status, missing file, etc.) so the
 * route layer can map to HTTP 502 with a sanitized public message while the
 * server log retains the full detail.
 */
export class FetchError extends FetcherError {
  override readonly name = "FetchError";

  constructor(
    public readonly origin: string,
    public readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`failed to fetch "${origin}": ${reason}`, options);
  }
}
