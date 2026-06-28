/**
 * Declarative source-form of an agent. Counterpart to `AgentEntity` —
 * entity is the STATEFUL OWNED form held by our domain; manifest is
 * the DECLARATIVE SOURCE form coming from outside.
 *
 * `files` aligns with the existing catalog convention:
 *   - keys are POSIX relPaths under the entry root
 *   - values are `Buffer` (binary-safe; assets like icons survive)
 *   - the anchor file (AGENTS.md) is one entry in this map, not a
 *     separate field. Consumers needing the anchor body read
 *     `files.get("AGENTS.md")` and decode utf-8.
 *
 * The metadata fields (name / description / version / skills) are
 * extracted from the anchor's YAML frontmatter by the adapter. The
 * `AgentManifestMetadataSchema` below validates that part; `files` is
 * assembled by the adapter from the fetcher's output.
 */

import { z } from "zod";

export interface AgentManifest {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly skills: readonly string[];
  readonly files: ReadonlyMap<string, Buffer>;
}

/**
 * Validates the METADATA portion only (the anchor's YAML frontmatter).
 * `files` is assembled by the source adapter and is not part of the
 * schema-validated payload.
 */
export const AgentManifestMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  skills: z.array(z.string()).default([]),
});

export type AgentManifestMetadata = z.infer<typeof AgentManifestMetadataSchema>;
