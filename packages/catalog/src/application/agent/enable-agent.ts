import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

export const EnableAgentRequestSchema = z.object({ id: AgentFqnSchema });
export type EnableAgentRequest = z.infer<typeof EnableAgentRequestSchema>;

export const EnableAgentResponseSchema = z.object({
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
      skills: z.array(DependencyRefSchema).optional(),
      mcps: z.array(DependencyRefSchema).optional(),
      agents: z.array(DependencyRefSchema).optional(),
    })
    .optional(),
});
export type EnableAgentResponse = z.infer<typeof EnableAgentResponseSchema>;
export type EnableAgentError = AgentNotFound | DatabaseUnavailable;

export interface EnableAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class EnableAgentUseCase
  implements UseCase<EnableAgentRequest, EnableAgentResponse, EnableAgentError>
{
  constructor(private readonly deps: EnableAgentDeps) {}

  async execute(request: EnableAgentRequest): UseCaseResult<EnableAgentResponse, EnableAgentError> {
    return this.deps.agentRepo
      .get(request.id)
      .map((agent) => {
        if (agent.disabledByUser) agent.enable();
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
