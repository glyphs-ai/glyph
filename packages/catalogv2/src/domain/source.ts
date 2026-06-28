/**
 * Generic output port for "load a typed value from an external origin".
 *
 * Sources are domain-owned ports — they declare WHAT the application
 * wants (a typed `T`), without prescribing HOW it's fetched or parsed.
 * Adapters in `infrastructure/` implement specific transports +
 * formats (e.g. `MarkdownAgentSource implements Source<AgentManifest>`).
 *
 * Application sites should depend on `Source<T>` directly — no
 * per-aggregate alias file is needed (e.g. `type AgentSource =
 * Source<AgentManifest>` is pure ceremony unless the contract diverges
 * from the generic shape).
 *
 * Error contract: three port-level atoms cover the failure modes
 * adapters can hit. Adapters translate their technical exceptions
 * (markdown parse, HTTP 5xx, fs ENOENT) into these business atoms at
 * THEIR boundary, so the application layer never sees library names.
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
