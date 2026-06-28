/**
 * Use case: create a brand-new agent.
 *
 * Schema-first contract (request + response). Each use-case owns its
 * own response shape inline — no shared view type — so future field
 * additions to one use-case's response do NOT ripple into siblings.
 */

import { z } from "zod";
import { AgentEntity, agentId } from "../domain/agent-entity.js";
import type { InvalidAgentName } from "../domain/agent-errors.js";
import type { AgentRepository, DatabaseUnavailable } from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CreateAgentRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const CreateAgentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type CreateAgentResponse = z.infer<typeof CreateAgentResponseSchema>;

export type CreateAgentError = InvalidAgentName | DatabaseUnavailable;

export interface CreateAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class CreateAgentUseCase
  implements UseCase<CreateAgentRequest, CreateAgentResponse, CreateAgentError>
{
  constructor(private readonly deps: CreateAgentDeps) {}

  async execute(request: CreateAgentRequest): UseCaseResult<CreateAgentResponse, CreateAgentError> {
    return AgentEntity.create(agentId(request.id), request.name)
      .asyncAndThen((agent) => this.deps.agentRepo.save(agent).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
