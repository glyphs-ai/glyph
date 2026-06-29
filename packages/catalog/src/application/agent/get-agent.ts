import { err, ok } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

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
      skills: z.array(DependencyRefSchema).optional(),
      mcps: z.array(DependencyRefSchema).optional(),
      agents: z.array(DependencyRefSchema).optional(),
    })
    .optional(),
});
export type GetAgentResponse = z.infer<typeof GetAgentResponseSchema>;
export type GetAgentError = AgentNotFound | DatabaseUnavailable;

export interface GetAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class GetAgentUseCase implements UseCase<GetAgentRequest, GetAgentResponse, GetAgentError> {
  constructor(private readonly deps: GetAgentDeps) {}

  async execute(request: GetAgentRequest): UseCaseResult<GetAgentResponse, GetAgentError> {
    const found = await this.deps.agentRepo.get(request.id);
    if (found.isErr()) {
      return err(found.error);
    }
    const agent = found.value;
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
    return ok({
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
    });
  }
}
