/**
 * JSON-backed MCP source — implements `Source<McpManifest>`.
 *
 * Thin transport adapter: fetch bytes → take the sole file (an MCP
 * origin resolves to exactly one JSON client-config, no directory tree)
 * → `JSON.parse` → hand the parsed value to `McpManifest.create`. Spec
 * compliance (the `_meta.name` fqn) is the manifest's call, not ours; we
 * only own transport-level faults — empty origin, malformed JSON — and
 * fold the manifest's `McpManifestInvalid` into the port-level
 * `ManifestInvalid`. Application code never sees JSON errors or library
 * names. Fetcher faults already arrive as `OriginInvalid` /
 * `SourceUnavailable`.
 */

import { err, type Result, type ResultAsync } from "neverthrow";
import { McpManifest } from "../../domain/mcp-manifest.js";
import type { ManifestInvalid, Source, SourceError } from "../../domain/source.js";
import type { FetcherRegistry } from "./fetcher/registry.js";

export class JsonMcpSource implements Source<McpManifest> {
  constructor(private readonly fetcher: FetcherRegistry) {}

  load(origin: string): ResultAsync<McpManifest, SourceError> {
    return this.fetcher.fetchEntry(origin).andThen((files) => this.parseManifest(origin, files));
  }

  private parseManifest(
    origin: string,
    files: ReadonlyMap<string, Buffer>,
  ): Result<McpManifest, ManifestInvalid> {
    const first = files.values().next();
    if (first.done) {
      return err({ type: "ManifestInvalid", origin, reason: "origin yielded no MCP file" });
    }
    const spec = first.value.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(spec);
    } catch (cause) {
      return err({
        type: "ManifestInvalid",
        origin,
        reason: `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    return McpManifest.create(parsed, spec).mapErr((e) => ({
      type: "ManifestInvalid",
      origin,
      reason: e.reason,
    }));
  }
}
