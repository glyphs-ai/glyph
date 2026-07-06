import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const AcknowledgeAgentPrereqsRequestSchema = z.object({ id: AgentFqnSchema });
export type AcknowledgeAgentPrereqsRequest = z.infer<typeof AcknowledgeAgentPrereqsRequestSchema>;

export const AcknowledgeAgentPrereqsResponseSchema = z.object({
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
export type AcknowledgeAgentPrereqsResponse = z.infer<typeof AcknowledgeAgentPrereqsResponseSchema>;
export type AcknowledgeAgentPrereqsError = AgentNotFound | DatabaseUnavailable;

export interface AcknowledgeAgentPrereqsDeps {
  readonly agentRepo: AgentRepository;
}

export class AcknowledgeAgentPrereqsUseCase
  implements
    UseCase<
      AcknowledgeAgentPrereqsRequest,
      AcknowledgeAgentPrereqsResponse,
      AcknowledgeAgentPrereqsError
    >
{
  constructor(private readonly deps: AcknowledgeAgentPrereqsDeps) {}

  execute(
    request: AcknowledgeAgentPrereqsRequest,
  ): UseCaseResult<AcknowledgeAgentPrereqsResponse, AcknowledgeAgentPrereqsError> {
    return this.deps.agentRepo
      .get(request.id)
      .map((agent) => {
        agent.acknowledgePrereqs();
        return agent;
      })
      .andThen((agent) => this.deps.agentRepo.save(agent).map(() => agent))
      .map((agent) => {
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
      });
  }
}
