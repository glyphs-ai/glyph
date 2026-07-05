/**
 * Use case: uninstall an agent. Refuses to delete an agent that another
 * installed agent still depends on (agent→agent edges) — deleting it would
 * dangle a dep edge. The guard reads the agent-agent edge table through the
 * read-side queries seam. Surfaces a typed `AgentNotFound` (worth the extra
 * round trip vs a silent idempotent drop) and `HasDependents` when something
 * still references it.
 *
 * Response is `void` (HTTP semantics: 204 No Content).
 */

import { errAsync } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedAgentFqns } from "./agent-reads.js";

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
  readonly queries: CatalogQueries;
}

export class UninstallAgentUseCase
  implements UseCase<UninstallAgentRequest, UninstallAgentResponse, UninstallAgentError>
{
  constructor(private readonly deps: UninstallAgentDeps) {}

  execute(
    request: UninstallAgentRequest,
  ): UseCaseResult<UninstallAgentResponse, UninstallAgentError> {
    const id = request.id;
    return this.deps.agentRepo
      .get(id)
      .andThen(() => this.deps.queries.query((db) => collectReferencedAgentFqns(db).has(id)))
      .andThen((usedByAgent) =>
        usedByAgent
          ? errAsync<UninstallAgentResponse, HasDependents>({ type: "HasDependents", fqn: id })
          : this.deps.agentRepo.delete(id),
      );
  }
}
