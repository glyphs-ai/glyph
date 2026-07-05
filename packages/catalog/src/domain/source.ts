/**
 * Generic output port for resolving and fetching entries from external origins.
 *
 * Two levels of detail:
 *   - `resolve` — lightweight: only the anchor file (SKILL.md / AGENTS.md /
 *     the JSON spec) is fetched + parsed into the typed manifest. Used by
 *     resolve-plan to identify + diff without pulling the full file tree.
 *   - `fetch` — heavyweight: the complete directory tree is fetched, returning
 *     the manifest plus all files. Used by install to persist the entry on disk.
 *
 * Adapters translate technical failures into `OriginInvalid`,
 * `SourceUnavailable`, or `ManifestInvalid`.
 */

import type { ResultAsync } from "neverthrow";

/** File tree: POSIX relative paths → raw bytes. */
export type SourceFiles = ReadonlyMap<string, Buffer>;

export interface Source<T> {
  /** Resolve identity + dependency metadata from the anchor file only (lightweight). */
  resolve(origin: string): ResultAsync<T, SourceError>;

  /** Fetch the complete manifest + all files (heavyweight; used for install). */
  fetch(origin: string): ResultAsync<{ manifest: T; files: SourceFiles }, SourceError>;
}

export type SourceError = OriginInvalid | SourceUnavailable | ManifestInvalid;

/** Caller-fixable: origin string is malformed (unsupported scheme, bad URI). */
export type OriginInvalid = {
  readonly type: "OriginInvalid";
  readonly origin: string;
  readonly reason: string;
};

/** Transient/infra: can't reach the origin (network down, fs permission). */
export type SourceUnavailable = {
  readonly type: "SourceUnavailable";
  readonly origin: string;
  readonly cause: unknown;
};

/** Got bytes, but they don't parse to a valid manifest for this kind. */
export type ManifestInvalid = {
  readonly type: "ManifestInvalid";
  readonly origin: string;
  readonly reason: string;
};
