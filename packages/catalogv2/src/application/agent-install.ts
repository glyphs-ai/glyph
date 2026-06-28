/**
 * Use case: install an agent from a source origin.
 *
 * The canonical end-to-end demonstration of the catalogv2 architecture:
 *
 *   Source.load(origin)                             [infra: fetch + parse + zod validate]
 *      ↓ ResultAsync<AgentManifest, SourceError>
 *   AgentEntity.fromManifest(manifest, ctx)         [domain factory]
 *      ↓ Result<AgentEntity, InvalidManifest>
 *   AgentRepository.save(agent, files)              [persistence adapter — atomic write]
 *      ↓ ResultAsync<void, DatabaseUnavailable>
 *   project to response                             [application]
 *
 * The application is a pure orchestrator: it owns NONE of fetch / parse
 * / sql, only the SEQUENCE. Each step is a coordination call against a
 * port.
 *
 * Scope notes (skeleton-level):
 *   - The id is derived as `public/<manifest.name>` for simplicity.
 *     Real catalog computes scope from manifest + install args.
 *   - Skill ref resolution is skipped; `ctx.skills` is empty. Real
 *     catalog resolves `manifest.skills[]` string refs against an
 *     installed-skills index before constructing the entity.
 */

import { z } from "zod";
import { AgentEntity, agentId } from "../domain/agent-entity.js";
import type { InvalidManifest } from "../domain/agent-errors.js";
import type { AgentManifest } from "../domain/agent-manifest.js";
import type { AgentRepository, DatabaseUnavailable } from "../domain/agent-repository.js";
import type { Source, SourceError } from "../domain/source.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const InstallAgentRequestSchema = z.object({
  origin: z.string(),
});
export type InstallAgentRequest = z.infer<typeof InstallAgentRequestSchema>;

export const InstallAgentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  skills: z.array(z.string()),
});
export type InstallAgentResponse = z.infer<typeof InstallAgentResponseSchema>;

export type InstallAgentError = SourceError | InvalidManifest | DatabaseUnavailable;

export interface InstallAgentDeps {
  readonly agentSource: Source<AgentManifest>;
  readonly agentRepo: AgentRepository;
}

export class InstallAgentUseCase
  implements UseCase<InstallAgentRequest, InstallAgentResponse, InstallAgentError>
{
  constructor(private readonly deps: InstallAgentDeps) {}

  async execute(
    request: InstallAgentRequest,
  ): UseCaseResult<InstallAgentResponse, InstallAgentError> {
    return this.deps.agentSource
      .load(request.origin)
      .andThen((manifest) =>
        AgentEntity.fromManifest(manifest, {
          id: agentId(`public/${manifest.name}`),
          skills: [],
        }).map((agent) => ({ agent, files: manifest.files })),
      )
      .andThen(({ agent, files }) => this.deps.agentRepo.save(agent, files).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        version: agent.version,
        enabled: agent.enabled,
        skills: [...agent.skills],
      }));
  }
}
