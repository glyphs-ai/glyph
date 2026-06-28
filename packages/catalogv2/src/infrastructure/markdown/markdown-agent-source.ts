/**
 * Markdown-backed AgentSource adapter — implements `Source<AgentManifest>`.
 *
 * Composes two collaborators (both ports defined in domain/):
 *   - `Fetcher` to materialise the entry's file tree from an origin
 *   - inline gray-matter parsing of the anchor file (AGENTS.md)
 *
 * Error translation at the adapter boundary (the "infra → business"
 * pattern):
 *   - gray-matter throws → caught here → `ManifestInvalid` (port-level
 *     business term). The application layer never sees
 *     `MarkdownParseError` / library names.
 *   - Missing anchor file → `ManifestInvalid` (not a fetch failure;
 *     the entry was reachable, it just isn't a valid agent).
 *   - Fetcher's own errors (network, fs) propagate as `OriginInvalid`
 *     / `SourceUnavailable` (already business-named at the Fetcher port).
 *
 * This is also where the metadata Zod schema gets applied — manifest's
 * `files` is assembled by the adapter; only the YAML frontmatter side
 * is schema-validated.
 */

import grayMatter from "gray-matter";
import { err, ok, type Result, type ResultAsync } from "neverthrow";

import { type AgentManifest, AgentManifestMetadataSchema } from "../../domain/agent-manifest.js";
import type { ManifestInvalid, Source, SourceError } from "../../domain/source.js";
import type { Fetcher } from "../fetcher/fetcher.js";

const ANCHOR = "AGENTS.md";

export class MarkdownAgentSource implements Source<AgentManifest> {
  constructor(private readonly fetcher: Fetcher) {}

  load(origin: string): ResultAsync<AgentManifest, SourceError> {
    return this.fetcher.fetchEntry(origin).andThen((files) => this.parseManifest(origin, files));
  }

  private parseManifest(
    origin: string,
    files: ReadonlyMap<string, Buffer>,
  ): Result<AgentManifest, ManifestInvalid> {
    const anchor = files.get(ANCHOR);
    if (anchor === undefined) {
      return err({
        type: "ManifestInvalid",
        origin,
        reason: `missing anchor file ${ANCHOR}`,
      });
    }
    let parsed: ReturnType<typeof grayMatter>;
    try {
      parsed = grayMatter(anchor.toString("utf8"));
    } catch (cause) {
      return err({
        type: "ManifestInvalid",
        origin,
        reason: `failed to parse ${ANCHOR} frontmatter: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
    const meta = AgentManifestMetadataSchema.safeParse(parsed.data);
    if (!meta.success) {
      return err({
        type: "ManifestInvalid",
        origin,
        reason: `frontmatter shape: ${meta.error.message}`,
      });
    }
    return ok({
      name: meta.data.name,
      description: meta.data.description,
      version: meta.data.version,
      skills: meta.data.skills,
      files,
    });
  }
}
