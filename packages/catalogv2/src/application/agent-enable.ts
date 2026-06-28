/**
 * Use case: enable an agent (mirror of disable-agent).
 */

import { z } from "zod";
import { agentId } from "../domain/agent-entity.js";
import type { AgentAlreadyEnabled } from "../domain/agent-errors.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const EnableAgentRequestSchema = z.object({
  id: z.string(),
});
export type EnableAgentRequest = z.infer<typeof EnableAgentRequestSchema>;

export const EnableAgentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type EnableAgentResponse = z.infer<typeof EnableAgentResponseSchema>;

export type EnableAgentError = AgentNotFound | AgentAlreadyEnabled | DatabaseUnavailable;

export interface EnableAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class EnableAgentUseCase
  implements UseCase<EnableAgentRequest, EnableAgentResponse, EnableAgentError>
{
  constructor(private readonly deps: EnableAgentDeps) {}

  async execute(request: EnableAgentRequest): UseCaseResult<EnableAgentResponse, EnableAgentError> {
    return this.deps.agentRepo
      .get(agentId(request.id))
      .andThen((agent) => agent.enable().map(() => agent))
      .andThen((agent) => this.deps.agentRepo.save(agent).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
