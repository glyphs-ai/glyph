import { err, ok } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

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
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
}

export class GetSkillUseCase implements UseCase<GetSkillRequest, GetSkillResponse, GetSkillError> {
  constructor(private readonly deps: GetSkillDeps) {}

  async execute(request: GetSkillRequest): UseCaseResult<GetSkillResponse, GetSkillError> {
    const skill = await this.deps.skillRepo.get(request.id);
    if (skill.isErr()) {
      return err(skill.error);
    }
    const agents = await this.deps.agentRepo.list();
    if (agents.isErr()) return err(agents.error);
    const skills = await this.deps.skillRepo.list();
    if (skills.isErr()) return err(skills.error);
    const referencedSkillFqns = new Set<string>();
    for (const agent of agents.value) {
      for (const fqn of agent.dependencyRefs.skills) referencedSkillFqns.add(fqn);
    }
    for (const installedSkill of skills.value) {
      for (const fqn of installedSkill.dependencyRefs.skills) referencedSkillFqns.add(fqn);
    }
    const dependencies =
      skill.value.dependencyRefs.skills.length > 0 || skill.value.dependencyRefs.mcps.length > 0
        ? {
            ...(skill.value.dependencyRefs.skills.length > 0
              ? { skills: skill.value.dependencyRefs.skills.map((fqn) => ({ fqn })) }
              : {}),
            ...(skill.value.dependencyRefs.mcps.length > 0
              ? { mcps: skill.value.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
              : {}),
          }
        : undefined;
    return ok({
      fqn: skill.value.fqn,
      origin: skill.value.origin,
      description: skill.value.description,
      version: skill.value.version,
      ...(skill.value.prereqs !== undefined ? { prereqs: skill.value.prereqs } : {}),
      prereqsAck: skill.value.prereqsAck,
      orphaned: !referencedSkillFqns.has(skill.value.fqn),
      installedAt: skill.value.installedAt,
      updatedAt: skill.value.updatedAt,
      ...(dependencies !== undefined ? { dependencies } : {}),
    });
  }
}
