import { ok, safeTry } from "neverthrow";
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

export const AcknowledgePrereqsRequestSchema = z.object({ id: SkillFqnSchema });
export type AcknowledgePrereqsRequest = z.infer<typeof AcknowledgePrereqsRequestSchema>;
export const AcknowledgePrereqsResponseSchema = SkillSchema;
export type AcknowledgePrereqsResponse = Skill;
export type AcknowledgePrereqsError = SkillNotFound | DatabaseUnavailable;
export interface AcknowledgePrereqsDeps {
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
}

export class AcknowledgePrereqsUseCase
  implements UseCase<AcknowledgePrereqsRequest, AcknowledgePrereqsResponse, AcknowledgePrereqsError>
{
  constructor(private readonly deps: AcknowledgePrereqsDeps) {}

  execute(
    request: AcknowledgePrereqsRequest,
  ): UseCaseResult<AcknowledgePrereqsResponse, AcknowledgePrereqsError> {
    const deps = this.deps;
    return safeTry<AcknowledgePrereqsResponse, AcknowledgePrereqsError>(async function* () {
      const skill = yield* deps.skillRepo.get(request.id);
      skill.acknowledgePrereqs();
      yield* deps.skillRepo.save(skill);
      const agents = yield* deps.agentRepo.list();
      const skills = yield* deps.skillRepo.list();
      const referencedSkillFqns = new Set<string>();
      for (const agent of agents) {
        for (const fqn of agent.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      }
      for (const installedSkill of skills) {
        for (const fqn of installedSkill.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      }
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
      return ok({
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
      });
    });
  }
}
