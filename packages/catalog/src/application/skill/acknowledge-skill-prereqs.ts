import { ok, safeTry } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedSkillFqns } from "./skill-reads.js";

export const AcknowledgePrereqsRequestSchema = z.object({ id: SkillFqnSchema });
export type AcknowledgePrereqsRequest = z.infer<typeof AcknowledgePrereqsRequestSchema>;
export const AcknowledgePrereqsResponseSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: z
    .object({
      skills: z.array(z.object({ fqn: z.string() })).optional(),
      mcps: z.array(z.object({ fqn: z.string() })).optional(),
    })
    .optional(),
});
export type AcknowledgePrereqsResponse = z.infer<typeof AcknowledgePrereqsResponseSchema>;
export type AcknowledgePrereqsError = SkillNotFound | DatabaseUnavailable;
export interface AcknowledgePrereqsDeps {
  readonly skillRepo: SkillRepository;
  readonly queries: CatalogQueries;
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
      const referencedSkillFqns = yield* deps.queries.query((db) => collectReferencedSkillFqns(db));
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
