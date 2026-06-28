/**
 * Byte-source abstraction — INFRA-internal interface, NOT a port.
 *
 * Only used to compose Source adapters (e.g. `MarkdownAgentSource`
 * needs bytes to parse). Domain and application code MUST NOT depend
 * on `Fetcher`; they depend on the typed `Source<T>` ports above it.
 * Promote to a domain port only if a use-case ever needs raw bytes
 * without going through a Source (today: none).
 *
 * Adapters live in `infrastructure/<transport>/` — e.g.
 * `infrastructure/file/file-fetcher.ts`, `infrastructure/github/...`.
 * `MarkdownAgentSource` composes a `Fetcher` + markdown parsing to
 * implement `Source<AgentManifest>`.
 *
 * Naming aligns with the existing catalog convention:
 *   - `files` for the in-memory map
 *   - `Buffer` content (binary-safe; assets like icons survive)
 *   - POSIX relPaths regardless of host OS
 *   - the entry's anchor file (AGENTS.md / SKILL.md / `<name>.json`)
 *     is just one key in the map, not a separate field
 *
 * Error vocabulary borrowed from `domain/source.ts` so adapters can
 * compose: `OriginInvalid` for malformed origin URIs, `SourceUnavailable`
 * for transport/IO faults. Borrowing the names keeps source adapters'
 * andThen chains type-clean without an extra translation layer.
 */

import type { ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../domain/source.js";

export interface Fetcher {
  fetchEntry(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable>;
}
