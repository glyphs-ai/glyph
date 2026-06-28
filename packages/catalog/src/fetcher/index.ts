/**
 * Catalog fetchers — pluggable origin-URI fetchers used by catalog's
 * resolve + install pipeline. Owns:
 *
 *   - `Fetcher` interface (pure stream, fs-agnostic)
 *   - `FileFetcher`, `GitHubFetcher`, `AzureDevOpsFetcher` — built-in
 *     implementations
 *   - `FetcherRegistry` — scheme to fetcher dispatch
 *   - `FetchError`, `FetcherError`, `OriginParseError`
 *
 * Single responsibility: turn a URI into a stream of bytes. No knowledge
 * of frontmatter, scope, identity, or dependencies — those live in the
 * parent catalog package. Origin-URI grammar (`parseOrigin`,
 * `safeNormalize`, …) is owned by `domain/catalog.origin.ts`.
 */

export {
  type AdoCredential,
  gitCredentialApprove,
  gitCredentialReject,
  invalidateAdoTokenCache,
  type ResolvedAdoToken,
  resolveDefaultAdoToken,
  tryGitCredentialFill,
} from "./ado-token.js";
export { AzureDevOpsFetcher } from "./azure-devops-fetcher.js";
export { FetchError, FetcherError, OriginParseError } from "./errors.js";
export type { EntryFile, Fetcher } from "./fetcher.js";
export { FileFetcher } from "./file-fetcher.js";
export { resolveDefaultGitHubToken, tryGhAuthToken } from "./gh-token.js";
export { GitHubFetcher } from "./github-fetcher.js";
export {
  normalizeOrigin,
  type ParsedOrigin,
  parseOrigin,
  safeNormalize,
  sameOrigin,
} from "./origin.js";
export { defaultFetcherRegistry, FetcherRegistry } from "./registry.js";
