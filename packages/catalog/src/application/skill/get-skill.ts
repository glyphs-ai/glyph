import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound } from "../../domain/skill-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedSkillFqns, selectSkillByFqn } from "./skill-reads.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

const SkillDependenciesSchema = z
  .object({
    skills: z.array(DependencyRefSchema).optional(),
    mcps: z.array(DependencyRefSchema).optional(),
  })
  .optional();

const SkillSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: SkillDependenciesSchema,
});
type Skill = z.infer<typeof SkillSchema>;

export const GetSkillRequestSchema = z.object({ id: SkillFqnSchema });
export type GetSkillRequest = z.infer<typeof GetSkillRequestSchema>;
export const GetSkillResponseSchema = SkillSchema;
export type GetSkillResponse = Skill;
export type GetSkillError = SkillNotFound | DatabaseUnavailable;
export interface GetSkillDeps {
  readonly queries: CatalogQueries;
}

export class GetSkillUseCase implements UseCase<GetSkillRequest, GetSkillResponse, GetSkillError> {
  constructor(private readonly deps: GetSkillDeps) {}

  execute(request: GetSkillRequest): UseCaseResult<GetSkillResponse, GetSkillError> {
    const { id } = request;
    return this.deps.queries
      .query((db): Skill | undefined => {
        const skill = selectSkillByFqn(db, id);
        if (skill === undefined) return undefined;
        const referencedSkillFqns = collectReferencedSkillFqns(db);
        const dependencies =
          skill.dependencyRefs.skills.length > 0 || skill.dependencyRefs.mcps.length > 0
            ? {
                ...(skill.dependencyRefs.skills.length > 0
                  ? { skills: skill.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(skill.dependencyRefs.mcps.length > 0
                  ? { mcps: skill.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;
        return {
          fqn: skill.fqn,
          origin: skill.origin,
          description: skill.description,
          version: skill.version,
          ...(skill.prereqs !== undefined ? { prereqs: skill.prereqs } : {}),
          prereqsAck: skill.prereqsAck,
          orphaned: !referencedSkillFqns.has(skill.fqn),
          installedAt: skill.installedAt,
          updatedAt: skill.updatedAt,
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
      })
      .andThen(
        (dto): UseCaseResult<GetSkillResponse, GetSkillError> =>
          dto === undefined ? errAsync({ type: "SkillNotFound", fqn: id }) : okAsync(dto),
      );
  }
}
