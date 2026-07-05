/**
 * Declarative source-form of a skill. Counterpart to `SkillEntity` —
 * entity is the STATEFUL OWNED form; manifest is the DECLARATIVE SOURCE
 * form coming from outside (a fetched skill tree anchored on SKILL.md).
 *
 * Like agent, a skill is a directory tree: `files` maps POSIX relPaths →
 * `Buffer` bytes, and SKILL.md is just one entry. Compliance is owned
 * here: `create` is the one door — fed the already-parsed frontmatter
 * plus the file tree, it validates the metadata and composes the fqn
 * (`<scope>/<short>`, scope defaulting to `public`). YAML parsing,
 * fetching bytes, "is SKILL.md present" stay upstream; a bad manifest is
 * `SkillManifestInvalid`, not a yaml error.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { SkillDependencyRefs } from "./skill-deps.js";
import { type SkillName, SkillNameSchema, type SkillScope, SkillScopeSchema } from "./skill-fqn.js";

/** Parsed frontmatter failed skill-manifest compliance. */
export type SkillManifestInvalid = {
  readonly type: "SkillManifestInvalid";
  readonly reason: string;
};

const FrontmatterSchema = z.object({
  name: SkillNameSchema,
  scope: SkillScopeSchema,
  description: z.string(),
  version: z.string().min(1),
  prereqs: z.string().optional(),
  dependencies: z
    .object({
      skills: z.array(z.string()).default([]),
      mcps: z.array(z.string()).default([]),
    })
    .partial()
    .default({}),
});

export class SkillManifest {
  private constructor(
    readonly scope: SkillScope,
    readonly name: SkillName,
    readonly description: string,
    readonly version: string,
    readonly prereqs: string | undefined,
    readonly dependencyRefs: SkillDependencyRefs,
  ) {}

  /**
   * Build a manifest from already-parsed frontmatter. Validates metadata and
   * keeps declared `scope` and `name`; the fqn is composed at install time.
   * Files are a separate concern — they travel alongside the manifest in the
   * `Source.fetch()` return, not inside it.
   */
  static create(frontmatter: unknown): Result<SkillManifest, SkillManifestInvalid> {
    const meta = FrontmatterSchema.safeParse(frontmatter);
    if (!meta.success) {
      return err({ type: "SkillManifestInvalid", reason: `frontmatter: ${meta.error.message}` });
    }
    return ok(
      new SkillManifest(
        meta.data.scope,
        meta.data.name,
        meta.data.description,
        meta.data.version,
        meta.data.prereqs,
        { skills: meta.data.dependencies.skills ?? [], mcps: meta.data.dependencies.mcps ?? [] },
      ),
    );
  }
}
