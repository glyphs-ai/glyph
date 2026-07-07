import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import { RegistryOriginSchema } from "../../domain/registry-origin.js";
import type { SkillDependencyRefs } from "../../domain/skill-deps.js";
import { SkillEntity } from "../../domain/skill-entity.js";
import { SkillFqn, SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillManifest } from "../../domain/skill-manifest.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { Source, SourceError } from "../../domain/source.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export type SkillOriginConflict = {
  readonly type: "SkillOriginConflict";
  readonly fqn: string;
  readonly existingOrigin: string;
  readonly attemptedOrigin: string;
};

export const InstallSkillRequestSchema = z.object({
  origin: RegistryOriginSchema,
  dependencyRefs: z.object({
    skills: z.array(SkillFqnSchema),
    mcps: z.array(McpFqnSchema),
  }),
});
// `z.input`: `dependencyRefs` entries are branded fqn value objects, so the
// caller-facing request keeps them as raw `string`s — the resolve pipeline
// feeds already-mapped sibling fqns in and the use-case forwards them verbatim.
export type InstallSkillRequest = z.input<typeof InstallSkillRequestSchema>;

export const InstallSkillResponseSchema = z.object({
  id: z.string(),
  origin: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
});
export type InstallSkillResponse = z.infer<typeof InstallSkillResponseSchema>;

export type InstallSkillError = SourceError | SkillOriginConflict | DatabaseUnavailable;

export interface InstallSkillDeps {
  readonly skillSource: Source<SkillManifest>;
  readonly skillRepo: SkillRepository;
}

type Built = { skill: SkillEntity; files: ReadonlyMap<string, Buffer> };

export class InstallSkillUseCase
  implements UseCase<InstallSkillRequest, InstallSkillResponse, InstallSkillError>
{
  constructor(private readonly deps: InstallSkillDeps) {}

  execute(request: InstallSkillRequest): UseCaseResult<InstallSkillResponse, InstallSkillError> {
    return this.deps.skillSource
      .fetch(request.origin)
      .andThen(({ manifest, files }) =>
        this.buildEntity(manifest, files, request.origin, request.dependencyRefs),
      )
      .andThen(({ skill, files }) => this.deps.skillRepo.save(skill, files).map(() => skill))
      .map((skill) => ({
        id: skill.id,
        origin: skill.origin,
        ...(skill.prereqs !== undefined && skill.prereqs.trim().length > 0
          ? { prereqs: skill.prereqs }
          : {}),
        prereqsAck: skill.prereqsAck,
      }));
  }

  private buildEntity(
    manifest: SkillManifest,
    files: ReadonlyMap<string, Buffer>,
    origin: string,
    dependencyRefs: SkillDependencyRefs,
  ): ResultAsync<Built, SkillOriginConflict | DatabaseUnavailable> {
    const fqn = SkillFqn.create(manifest.scope, manifest.name);
    const mint = (carriedAck: boolean): Built => {
      const skill = SkillEntity.create({
        scope: manifest.scope,
        name: manifest.name,
        origin,
        description: manifest.description,
        version: manifest.version,
        prereqs: manifest.prereqs,
        dependencyRefs,
        now: new Date().toISOString(),
      });
      if (carriedAck) skill.acknowledgePrereqs();
      return { skill, files };
    };
    return this.deps.skillRepo
      .get(fqn)
      .andThen((existing) =>
        existing.origin === origin
          ? okAsync(mint(existing.prereqs === manifest.prereqs ? existing.prereqsAck : false))
          : errAsync<Built, SkillOriginConflict>({
              type: "SkillOriginConflict",
              fqn,
              existingOrigin: existing.origin,
              attemptedOrigin: origin,
            }),
      )
      .orElse((e) => (e.type === "SkillNotFound" ? okAsync(mint(false)) : errAsync(e)));
  }
}
