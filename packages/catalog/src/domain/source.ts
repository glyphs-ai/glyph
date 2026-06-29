/**
 * Generic output port for loading a typed value from an external origin.
 *
 * Sources declare the typed value the application needs; infrastructure
 * adapters own transport and parsing. Adapters translate technical failures
 * into `OriginInvalid`, `SourceUnavailable`, or `ManifestInvalid`.
 */

import type { ResultAsync } from "neverthrow";

export interface Source<T> {
  load(origin: string): ResultAsync<T, SourceError>;
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
