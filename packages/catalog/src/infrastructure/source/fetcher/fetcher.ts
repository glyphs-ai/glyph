import type { ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../../domain/source.js";

/**
 * `Fetcher` — one transport leaf. It claims the origin URIs it owns
 * (`matches`) and materialises that entry's files into an in-memory map
 * (`fetch`). Each leaf owns its full origin grammar + transport AND its own
 * error translation: a malformed origin → `OriginInvalid` (caller-fixable),
 * a transport fault → `SourceUnavailable`. Fetchers are throw-free, so leaves
 * return `ResultAsync`, never raise. The {@link FetcherRegistry} root only
 * selects + delegates.
 */
export interface Fetcher {
  matches(uri: string): boolean;
  fetch(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable>;
}
