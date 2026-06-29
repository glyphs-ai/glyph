/**
 * Use case: uninstall a skill. Refuses to delete a skill that another
 * installed agent or skill still depends on — deleting it would leave a
 * dangling dep edge. The guard asks each potential dependent kind's
 * repository whether ANY of its own entities reference this fqn (an
 * indexed `exists` probe on each repo's OWN dep table, never a
 * cross-aggregate table read). `SkillNotFound` when the fqn doesn't
 * resolve; `HasDependents` when something still references it.
 */

import { err } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const UninstallSkillRequestSchema = z.object({
  id: SkillFqnSchema,
});
export type UninstallSkillRequest = z.infer<typeof UninstallSkillRequestSchema>;

export const UninstallSkillResponseSchema = z.object({
  id: z.string(),
});
export type UninstallSkillResponse = z.infer<typeof UninstallSkillResponseSchema>;

export type HasDependents = {
  readonly type: "HasDependents";
  readonly fqn: string;
};

export type UninstallSkillError = SkillNotFound | HasDependents | DatabaseUnavailable;

export interface UninstallSkillDeps {
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
}

export class UninstallSkillUseCase
  implements UseCase<UninstallSkillRequest, UninstallSkillResponse, UninstallSkillError>
{
  constructor(private readonly deps: UninstallSkillDeps) {}

  async execute(
    request: UninstallSkillRequest,
  ): UseCaseResult<UninstallSkillResponse, UninstallSkillError> {
    const fqn = request.id;
    const found = await this.deps.skillRepo.get(fqn);
    if (found.isErr()) return err(found.error);

    const byAgent = await this.deps.agentRepo.existsUsingSkill(fqn);
    if (byAgent.isErr()) return err(byAgent.error);
    const bySkill = await this.deps.skillRepo.existsUsingSkill(fqn);
    if (bySkill.isErr()) return err(bySkill.error);
    if (byAgent.value || bySkill.value) return err({ type: "HasDependents", fqn });

    return this.deps.skillRepo.delete(fqn).map(() => ({ id: fqn }));
  }
}
