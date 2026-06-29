/**
 * Declarative source-form of an agent. Counterpart to `AgentEntity` —
 * entity is the STATEFUL OWNED form held by our domain; manifest is the
 * DECLARATIVE SOURCE form coming from outside (a fetched agent tree
 * anchored on AGENTS.md).
 *
 * Like skill, an agent is a directory tree: `files` maps POSIX relPaths →
 * `Buffer` bytes, and AGENTS.md is just one entry. Compliance is owned
 * here: `create` is the one door — fed the already-parsed frontmatter
 * plus the file tree, it validates the metadata and composes the fqn
 * (`<scope>/<short>`, scope defaulting to `public`). YAML parsing,
 * fetching bytes, "is AGENTS.md present" stay upstream; a bad manifest is
 * `AgentManifestInvalid`, not a yaml error.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { AgentDependencyRefs } from "./agent-deps.js";
import { type AgentName, AgentNameSchema, type AgentScope, AgentScopeSchema } from "./agent-fqn.js";

/** Parsed frontmatter failed agent-manifest compliance. */
export type AgentManifestInvalid = {
  readonly type: "AgentManifestInvalid";
  readonly reason: string;
};

const FrontmatterSchema = z.object({
  name: AgentNameSchema,
  scope: AgentScopeSchema,
  description: z.string().default(""),
  version: z.string().min(1),
  prereqs: z.string().optional(),
  dependencies: z
    .object({
      skills: z.array(z.string()).default([]),
      mcps: z.array(z.string()).default([]),
      agents: z.array(z.string()).default([]),
    })
    .partial()
    .default({}),
});

export class AgentManifest {
  private constructor(
    readonly scope: AgentScope,
    readonly name: AgentName,
    readonly description: string,
    readonly version: string,
    readonly prereqs: string | undefined,
    readonly dependencyRefs: AgentDependencyRefs,
    readonly files: ReadonlyMap<string, Buffer>,
  ) {}

  /**
   * Build a manifest from already-parsed frontmatter plus the file tree.
   *
   * Validates metadata, keeps declared `scope` and `name`, and stores
   * dependency origins for install-time resolution.
   */
  static create(
    frontmatter: unknown,
    files: ReadonlyMap<string, Buffer>,
  ): Result<AgentManifest, AgentManifestInvalid> {
    const meta = FrontmatterSchema.safeParse(frontmatter);
    if (!meta.success) {
      return err({ type: "AgentManifestInvalid", reason: `frontmatter: ${meta.error.message}` });
    }
    return ok(
      new AgentManifest(
        meta.data.scope,
        meta.data.name,
        meta.data.description,
        meta.data.version,
        meta.data.prereqs,
        {
          skills: meta.data.dependencies.skills ?? [],
          mcps: meta.data.dependencies.mcps ?? [],
          agents: meta.data.dependencies.agents ?? [],
        },
        files,
      ),
    );
  }
}
