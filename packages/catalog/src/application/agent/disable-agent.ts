import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const DisableAgentRequestSchema = z.object({ id: AgentFqnSchema });
export type DisableAgentRequest = z.infer<typeof DisableAgentRequestSchema>;

// Deliberate duplication: this agent projection is intentionally NOT shared
// with the sibling agent use cases that expose the same shape. Each owns its
// V1 response so a later evolution of one caller never drags the others along
// in lockstep. Redundancy > coupling.
export const DisableAgentResponseSchema = z.object({
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
export type DisableAgentResponse = z.infer<typeof DisableAgentResponseSchema>;
export type DisableAgentError = AgentNotFound | DatabaseUnavailable;

export interface DisableAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class DisableAgentUseCase
  implements UseCase<DisableAgentRequest, DisableAgentResponse, DisableAgentError>
{
  constructor(private readonly deps: DisableAgentDeps) {}

  execute(request: DisableAgentRequest): UseCaseResult<DisableAgentResponse, DisableAgentError> {
    return this.deps.agentRepo
      .get(request.id)
      .map((agent) => {
        if (!agent.disabledByUser) agent.disable();
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
