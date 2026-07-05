import type { ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../../domain/source.js";

/**
 * `Fetcher` — one transport leaf. It claims the origin URIs it owns
 * (`matches`) and materialises entries into in-memory buffers. Two
 * granularities:
 *
 *   - `fetch` — full directory tree (all files). Used by install.
 *   - `fetchFile` — single file by relative path. Used by resolve
 *     (only needs the anchor file, not the whole tree).
 *
 * Each leaf owns its full origin grammar + transport AND its own error
 * translation: a malformed origin → `OriginInvalid` (caller-fixable),
 * a transport fault → `SourceUnavailable`. Fetchers are throw-free.
 */
export interface Fetcher {
  matches(uri: string): boolean;
  /** Fetch the complete file tree for the origin. */
  fetch(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable>;
  /** Fetch a single file by its relative path within the origin. */
  fetchFile(
    origin: string,
    relPath: string,
  ): ResultAsync<Buffer, OriginInvalid | SourceUnavailable>;
}
