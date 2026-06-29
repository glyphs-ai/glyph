/**
 * Declarative source-form of an MCP. Counterpart to `McpEntity` —
 * entity is the STATEFUL OWNED form held by our domain; manifest is the
 * DECLARATIVE SOURCE form coming from outside.
 *
 * Unlike agent (a directory tree anchored on AGENTS.md), an MCP is a
 * single JSON client-config file, so the manifest carries the raw spec
 * bytes directly — there is no `files` map.
 *
 * Compliance is owned here, not by the source adapter: `create` is the
 * one door, and it judges whether a parsed client-config is a valid MCP
 * manifest — a reserved `_meta.name` present and a legal fqn. Transport
 * concerns (fetching bytes, `JSON.parse`, "is this even an object") stay
 * upstream; `create` is handed the already-parsed value plus the raw
 * spec bytes and checks only spec compliance. A bad spec is a domain
 * outcome (`McpManifestInvalid`), not a JSON parse error.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { McpFqn } from "./mcp-fqn.js";
import { McpFqnSchema } from "./mcp-fqn.js";

/** A parsed client-config failed MCP-manifest compliance. */
export type McpManifestInvalid = {
  readonly type: "McpManifestInvalid";
  readonly reason: string;
};

const MetadataSchema = z.object({
  _meta: z.object({ name: z.string().min(1) }),
});

export class McpManifest {
  private constructor(
    readonly name: McpFqn,
    readonly spec: string,
  ) {}

  /**
   * Build a manifest from an already-parsed client-config plus its raw
   * bytes. Validates the reserved `_meta.name` against the fqn grammar and
   * stores the full client-config body verbatim in `spec`.
   */
  static create(parsed: unknown, spec: string): Result<McpManifest, McpManifestInvalid> {
    const meta = MetadataSchema.safeParse(parsed);
    if (!meta.success) {
      return err({ type: "McpManifestInvalid", reason: `_meta shape: ${meta.error.message}` });
    }
    const fqn = McpFqnSchema.safeParse(meta.data._meta.name);
    if (!fqn.success) {
      return err({ type: "McpManifestInvalid", reason: `_meta.name: ${fqn.error.message}` });
    }
    return ok(new McpManifest(fqn.data, spec));
  }
}
