/**
 * Markdown-backed SkillSource adapter — implements `Source<SkillManifest>`.
 *
 * Thin transport: fetch the file tree → require the SKILL.md anchor →
 * gray-matter the frontmatter → hand the parsed data + tree to
 * `SkillManifest.create`. Compliance (fqn/scope/version/deps) is the
 * manifest's call; we own only transport-level faults (missing anchor,
 * frontmatter parse) and fold the manifest's `SkillManifestInvalid` into
 * the port-level `ManifestInvalid`. Fetcher faults already arrive as
 * `OriginInvalid` / `SourceUnavailable`.
 */

import grayMatter from "gray-matter";
import { err, type Result, type ResultAsync } from "neverthrow";

import { SkillManifest } from "../../domain/skill-manifest.js";
import type { ManifestInvalid, Source, SourceError } from "../../domain/source.js";
import type { FetcherRegistry } from "./fetcher/registry.js";

const ANCHOR = "SKILL.md";

export class MarkdownSkillSource implements Source<SkillManifest> {
  constructor(private readonly fetcher: FetcherRegistry) {}

  resolve(origin: string): ResultAsync<SkillManifest, SourceError> {
    return this.fetcher
      .fetchAnchor(origin, ANCHOR)
      .andThen((buf) => this.parseManifest(origin, buf));
  }

  fetch(
    origin: string,
  ): ResultAsync<{ manifest: SkillManifest; files: ReadonlyMap<string, Buffer> }, SourceError> {
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

  private parseManifest(origin: string, anchor: Buffer): Result<SkillManifest, ManifestInvalid> {
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
    return SkillManifest.create(parsed.data).mapErr((e) => ({
      type: "ManifestInvalid",
      origin,
      reason: e.reason,
    }));
  }
}
