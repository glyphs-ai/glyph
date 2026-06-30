import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { SkillDependencyRefs } from "../../domain/skill-deps.js";
import { SkillEntity } from "../../domain/skill-entity.js";
import { SkillFqn } from "../../domain/skill-fqn.js";
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

const SkillDependencyRefsSchema = z.object({
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
});

export const InstallSkillRequestSchema = z.object({
  origin: z.string(),
  dependencyRefs: SkillDependencyRefsSchema.optional(),
});
export type InstallSkillRequest = z.infer<typeof InstallSkillRequestSchema>;

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
      .load(request.origin)
      .andThen((manifest) => this.buildEntity(manifest, request.origin, request.dependencyRefs))
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
    origin: string,
    dependencyRefs: SkillDependencyRefs | undefined,
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
        dependencyRefs: dependencyRefs ?? manifest.dependencyRefs,
        now: new Date().toISOString(),
      });
      if (carriedAck) skill.acknowledgePrereqs();
      return { skill, files: manifest.files };
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
