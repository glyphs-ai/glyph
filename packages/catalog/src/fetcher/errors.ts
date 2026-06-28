/**
 * Error types thrown by the `src/fetcher/` adapter. The fetcher subdir is
 * the catalog's bytes-on-disk layer — origin-URI grammar + remote fetch —
 * with no knowledge of frontmatter, scope, identity, or deps.
 */

export class FetcherError extends Error {
  override readonly name: string = "FetcherError";
}

/**
 * Origin URI failed provider parsing. Surfaces the raw URI plus the reason
 * so the dashboard / CLI can echo it back. Supported origins are GitHub
 * tree URLs, Azure DevOps Services item URLs, and `file:<absolutePath>`.
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
