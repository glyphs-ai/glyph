import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { AgentNotFound, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { selectAgentByFqn } from "./agent-reads.js";

export const GetAgentRequestSchema = z.object({ id: AgentFqnSchema });
export type GetAgentRequest = z.infer<typeof GetAgentRequestSchema>;

export const GetAgentResponseSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  disabledByUser: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: z
    .object({
      skills: z.array(z.object({ fqn: z.string() })).optional(),
      mcps: z.array(z.object({ fqn: z.string() })).optional(),
      agents: z.array(z.object({ fqn: z.string() })).optional(),
    })
    .optional(),
});
export type GetAgentResponse = z.infer<typeof GetAgentResponseSchema>;
export type GetAgentError = AgentNotFound | DatabaseUnavailable;

export interface GetAgentDeps {
  readonly queries: CatalogQueries;
}

export class GetAgentUseCase implements UseCase<GetAgentRequest, GetAgentResponse, GetAgentError> {
  constructor(private readonly deps: GetAgentDeps) {}

  execute(request: GetAgentRequest): UseCaseResult<GetAgentResponse, GetAgentError> {
    const { id } = request;
    return this.deps.queries
      .query(async (db): Promise<GetAgentResponse | undefined> => {
        const agent = await selectAgentByFqn(db, id);
        if (agent === undefined) return undefined;
        const dependencies =
          agent.dependencyRefs.skills.length > 0 ||
          agent.dependencyRefs.mcps.length > 0 ||
          agent.dependencyRefs.agents.length > 0
            ? {
                ...(agent.dependencyRefs.skills.length > 0
                  ? { skills: agent.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(agent.dependencyRefs.mcps.length > 0
                  ? { mcps: agent.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
                ...(agent.dependencyRefs.agents.length > 0
                  ? { agents: agent.dependencyRefs.agents.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;
        return {
          fqn: agent.fqn,
          origin: agent.origin,
          description: agent.description,
          version: agent.version,
          ...(agent.prereqs !== undefined ? { prereqs: agent.prereqs } : {}),
          prereqsAck: agent.prereqsAck,
          disabledByUser: agent.disabledByUser,
          installedAt: agent.installedAt,
          updatedAt: agent.updatedAt,
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
      })
      .andThen(
        (dto): UseCaseResult<GetAgentResponse, GetAgentError> =>
          dto === undefined ? errAsync({ type: "AgentNotFound", fqn: id }) : okAsync(dto),
      );
  }
}
