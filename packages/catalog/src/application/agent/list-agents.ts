/**
 * Use case: list all installed agents.
 *
 * The empty request keeps the dispatch shape uniform. The response projects
 * each agent's id, disabled state, and declared dependency refs.
 */

import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const ListAgentsRequestSchema = z.object({});
export type ListAgentsRequest = z.infer<typeof ListAgentsRequestSchema>;

export const ListAgentsResponseSchema = z.array(
  z.object({
    id: z.string(),
    disabledByUser: z.boolean(),
    skills: z.array(z.string()),
    mcps: z.array(z.string()),
    agents: z.array(z.string()),
  }),
);
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;

export type ListAgentsError = DatabaseUnavailable;

export interface ListAgentsDeps {
  readonly agentRepo: AgentRepository;
}

export class ListAgentsUseCase
  implements UseCase<ListAgentsRequest, ListAgentsResponse, ListAgentsError>
{
  constructor(private readonly deps: ListAgentsDeps) {}

  execute(_request: ListAgentsRequest): UseCaseResult<ListAgentsResponse, ListAgentsError> {
    return this.deps.agentRepo.list().map((agents) =>
      agents.map((agent) => ({
        id: agent.id,
        disabledByUser: agent.disabledByUser,
        skills: [...agent.dependencyRefs.skills],
        mcps: [...agent.dependencyRefs.mcps],
        agents: [...agent.dependencyRefs.agents],
      })),
    );
  }
}
