/**
 * Use case: list all installed agents.
 *
 * Read-only; the application's job here is to project to the response
 * DTO. Request is an empty object (`z.object({})`) — using `{}` over
 * `void` keeps the dispatch shape uniform across all use-cases and
 * reserves room for future filters (`{ enabled?: boolean; ... }`)
 * without a breaking signature change.
 *
 * Response shape is inline per use-case — no shared view type — so
 * `listAgents` can add list-only fields (e.g. `total` for pagination)
 * without rippling into single-agent use-cases.
 */

import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListAgentsRequestSchema = z.object({});
export type ListAgentsRequest = z.infer<typeof ListAgentsRequestSchema>;

export const ListAgentsResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    skills: z.array(z.string()),
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

  async execute(_request: ListAgentsRequest): UseCaseResult<ListAgentsResponse, ListAgentsError> {
    return this.deps.agentRepo.list().map((agents) =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        skills: [...agent.skills],
      })),
    );
  }
}
