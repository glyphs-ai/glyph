/**
 * Use case: list all installed agents.
 *
 * The empty request keeps the dispatch shape uniform. The response projects
 * each agent's id, disabled state, and declared dependency refs.
 */

import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { selectAllAgents } from "./agent-reads.js";

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
  readonly queries: CatalogQueries;
}

export class ListAgentsUseCase
  implements UseCase<ListAgentsRequest, ListAgentsResponse, ListAgentsError>
{
  constructor(private readonly deps: ListAgentsDeps) {}

  execute(_request: ListAgentsRequest): UseCaseResult<ListAgentsResponse, ListAgentsError> {
    return this.deps.queries.query(async (db) =>
      (await selectAllAgents(db)).map((agent) => ({
        id: agent.fqn,
        disabledByUser: agent.disabledByUser,
        skills: [...agent.dependencyRefs.skills],
        mcps: [...agent.dependencyRefs.mcps],
        agents: [...agent.dependencyRefs.agents],
      })),
    );
  }
}
