/**
 * Use case: uninstall an agent. Refuses to delete an agent that another
 * installed agent still depends on (agent→agent edges) — deleting it would
 * dangle a dep edge. The guard forward-scans installed agents for
 * references to this fqn, an application-layer read across sibling
 * aggregates. Surfaces a typed `AgentNotFound` (worth the extra round trip
 * vs a silent idempotent drop) and `HasDependents` when something still
 * references it.
 *
 * Response is `void` (HTTP semantics: 204 No Content).
 */

import { err } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const UninstallAgentRequestSchema = z.object({
  id: AgentFqnSchema,
});
export type UninstallAgentRequest = z.infer<typeof UninstallAgentRequestSchema>;

export const UninstallAgentResponseSchema = z.void();
export type UninstallAgentResponse = z.infer<typeof UninstallAgentResponseSchema>;

export type HasDependents = {
  readonly type: "HasDependents";
  readonly fqn: string;
};

export type UninstallAgentError = AgentNotFound | HasDependents | DatabaseUnavailable;

export interface UninstallAgentDeps {
  readonly agentRepo: AgentRepository;
}

export class UninstallAgentUseCase
  implements UseCase<UninstallAgentRequest, UninstallAgentResponse, UninstallAgentError>
{
  constructor(private readonly deps: UninstallAgentDeps) {}

  async execute(
    request: UninstallAgentRequest,
  ): UseCaseResult<UninstallAgentResponse, UninstallAgentError> {
    const id = request.id;
    const found = await this.deps.agentRepo.get(id);
    if (found.isErr()) return err(found.error);

    const usedByAgent = await this.deps.agentRepo.existsUsingAgent(id);
    if (usedByAgent.isErr()) return err(usedByAgent.error);
    if (usedByAgent.value) return err({ type: "HasDependents", fqn: id });

    return this.deps.agentRepo.delete(id);
  }
}
