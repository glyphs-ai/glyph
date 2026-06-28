/**
 * Use case: rename an agent.
 *
 * Pure single-aggregate operation. `Agent.rename` enforces the non-empty
 * invariant via a Result; the chain folds that into the use-case
 * error union automatically.
 */

import { z } from "zod";
import { agentId } from "../domain/agent-entity.js";
import type { InvalidAgentName } from "../domain/agent-errors.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RenameAgentRequestSchema = z.object({
  id: z.string(),
  newName: z.string(),
});
export type RenameAgentRequest = z.infer<typeof RenameAgentRequestSchema>;

export const RenameAgentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type RenameAgentResponse = z.infer<typeof RenameAgentResponseSchema>;

export type RenameAgentError = AgentNotFound | InvalidAgentName | DatabaseUnavailable;

export interface RenameAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class RenameAgentUseCase
  implements UseCase<RenameAgentRequest, RenameAgentResponse, RenameAgentError>
{
  constructor(private readonly deps: RenameAgentDeps) {}

  async execute(request: RenameAgentRequest): UseCaseResult<RenameAgentResponse, RenameAgentError> {
    return this.deps.agentRepo
      .get(agentId(request.id))
      .andThen((agent) => agent.rename(request.newName).map(() => agent))
      .andThen((agent) => this.deps.agentRepo.save(agent).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
