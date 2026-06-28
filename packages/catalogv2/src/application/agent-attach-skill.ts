/**
 * Use case: attach a skill to an agent — the canonical "Application
 * as Coordinator" example. Steps:
 *   1. Load the Agent aggregate; absent → `AgentNotFound`.
 *   2. Verify the referenced Skill exists via the `SkillRepository`
 *      port. `andThen` returning an err short-circuits with
 *      `SkillDoesNotExist`.
 *   3. Let `Agent.attachSkill` enforce its own invariant (no
 *      double-attach), returning a `Result`.
 *   4. Persist; project to the response DTO inline.
 *
 * `Agent` does NOT know that `Skill` exists in this repository — it
 * only operates on the `SkillId` set it holds. The existence check
 * belongs to the coordinator (this use-case), not the entity.
 *
 * `SkillDoesNotExist` is a use-case-local error (not on the
 * `SkillRepository` port) because the port only exposes a boolean
 * existence check; framing "false" as a failure is the use-case's
 * policy, not the port's outcome.
 */

import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { agentId, skillId } from "../domain/agent-entity.js";
import type { SkillAlreadyAttached } from "../domain/agent-errors.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../domain/agent-repository.js";
import type { SkillRepository } from "../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const AttachSkillRequestSchema = z.object({
  agentId: z.string(),
  skillId: z.string(),
});
export type AttachSkillRequest = z.infer<typeof AttachSkillRequestSchema>;

export const AttachSkillResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type AttachSkillResponse = z.infer<typeof AttachSkillResponseSchema>;

export type SkillDoesNotExist = {
  readonly type: "SkillDoesNotExist";
  readonly skillId: string;
};

export type AttachSkillError =
  | AgentNotFound
  | DatabaseUnavailable
  | SkillDoesNotExist
  | SkillAlreadyAttached;

export interface AttachSkillDeps {
  readonly agentRepo: AgentRepository;
  readonly skillRepo: SkillRepository;
}

export class AttachSkillUseCase
  implements UseCase<AttachSkillRequest, AttachSkillResponse, AttachSkillError>
{
  constructor(private readonly deps: AttachSkillDeps) {}

  async execute(request: AttachSkillRequest): UseCaseResult<AttachSkillResponse, AttachSkillError> {
    const { agentRepo, skillRepo } = this.deps;
    const brandedSkillId = skillId(request.skillId);
    return agentRepo
      .get(agentId(request.agentId))
      .andThen((agent) =>
        skillRepo.exists(brandedSkillId).andThen((exists) =>
          exists
            ? okAsync(agent)
            : errAsync<typeof agent, SkillDoesNotExist>({
                type: "SkillDoesNotExist",
                skillId: brandedSkillId,
              }),
        ),
      )
      .andThen((agent) => agent.attachSkill(brandedSkillId).map(() => agent))
      .andThen((agent) => agentRepo.save(agent).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
