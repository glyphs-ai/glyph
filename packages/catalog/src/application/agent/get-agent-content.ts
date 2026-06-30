import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetAgentContentRequestSchema = z.object({ id: AgentFqnSchema });
export type GetAgentContentRequest = z.infer<typeof GetAgentContentRequestSchema>;
export const GetAgentContentResponseSchema = z.object({ id: z.string(), content: z.string() });
export type GetAgentContentResponse = z.infer<typeof GetAgentContentResponseSchema>;
export type GetAgentContentError = AgentNotFound | DatabaseUnavailable;

export interface GetAgentContentDeps {
  readonly agentRepo: AgentRepository;
}

export class GetAgentContentUseCase
  implements UseCase<GetAgentContentRequest, GetAgentContentResponse, GetAgentContentError>
{
  constructor(private readonly deps: GetAgentContentDeps) {}

  execute(
    request: GetAgentContentRequest,
  ): UseCaseResult<GetAgentContentResponse, GetAgentContentError> {
    return this.deps.agentRepo
      .getAnchor(request.id)
      .map((content) => ({ id: request.id, content }));
  }
}
