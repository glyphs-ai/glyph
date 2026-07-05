/**
 * Markdown-backed AgentSource adapter — implements `Source<AgentManifest>`.
 *
 * Thin transport: fetch the file tree → require the AGENTS.md anchor →
 * gray-matter the frontmatter → hand the parsed data + tree to
 * `AgentManifest.create`. Compliance (fqn/scope/version/skills) is the
 * manifest's call; we own only transport-level faults (missing anchor,
 * frontmatter parse) and fold the manifest's `AgentManifestInvalid` into
 * the port-level `ManifestInvalid`. Fetcher faults already arrive as
 * `OriginInvalid` / `SourceUnavailable`.
 */

import grayMatter from "gray-matter";
import { err, type Result, type ResultAsync } from "neverthrow";

import { AgentManifest } from "../../domain/agent-manifest.js";
import type { ManifestInvalid, Source, SourceError } from "../../domain/source.js";
import type { FetcherRegistry } from "./fetcher/registry.js";

const ANCHOR = "AGENTS.md";

export class MarkdownAgentSource implements Source<AgentManifest> {
  constructor(private readonly fetcher: FetcherRegistry) {}

  resolve(origin: string): ResultAsync<AgentManifest, SourceError> {
    return this.fetcher
      .fetchAnchor(origin, ANCHOR)
      .andThen((buf) => this.parseManifest(origin, buf));
  }

  fetch(
    origin: string,
  ): ResultAsync<{ manifest: AgentManifest; files: ReadonlyMap<string, Buffer> }, SourceError> {
    return this.fetcher.fetchEntry(origin).andThen((files) => {
      const anchor = files.get(ANCHOR);
      if (anchor === undefined) {
        return err<never, ManifestInvalid>({
          type: "ManifestInvalid",
          origin,
          reason: `missing anchor file ${ANCHOR}`,
        });
      }
      return this.parseManifest(origin, anchor).map((manifest) => ({ manifest, files }));
    });
  }

  private parseManifest(origin: string, anchor: Buffer): Result<AgentManifest, ManifestInvalid> {
    let parsed: ReturnType<typeof grayMatter>;
    try {
      parsed = grayMatter(anchor.toString("utf8"));
    } catch (cause) {
      return err({
        type: "ManifestInvalid",
        origin,
        reason: `failed to parse ${ANCHOR} frontmatter: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    return AgentManifest.create(parsed.data).mapErr((e) => ({
      type: "ManifestInvalid",
      origin,
      reason: e.reason,
    }));
  }
}
