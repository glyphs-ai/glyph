/**
 * Use case: delete an agent.
 *
 * Get-then-delete: we surface a typed `AgentNotFound` (worth the extra
 * round trip vs a silent idempotent drop) and then issue the delete.
 * The chain folds both error sources into the same union.
 *
 * Response is `void` (HTTP semantics: 204 No Content).
 */

import { z } from "zod";
import { agentId } from "../domain/agent-entity.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteAgentRequestSchema = z.object({
  id: z.string(),
});
export type DeleteAgentRequest = z.infer<typeof DeleteAgentRequestSchema>;

export const DeleteAgentResponseSchema = z.void();
export type DeleteAgentResponse = z.infer<typeof DeleteAgentResponseSchema>;

export type DeleteAgentError = AgentNotFound | DatabaseUnavailable;

export interface DeleteAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class DeleteAgentUseCase
  implements UseCase<DeleteAgentRequest, DeleteAgentResponse, DeleteAgentError>
{
  constructor(private readonly deps: DeleteAgentDeps) {}

  async execute(request: DeleteAgentRequest): UseCaseResult<DeleteAgentResponse, DeleteAgentError> {
    const id = agentId(request.id);
    return this.deps.agentRepo.get(id).andThen(() => this.deps.agentRepo.delete(id));
  }
}
