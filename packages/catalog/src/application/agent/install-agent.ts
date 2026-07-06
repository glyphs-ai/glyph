import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AgentDependencyRefs } from "../../domain/agent-deps.js";
import { AgentEntity } from "../../domain/agent-entity.js";
import { AgentFqn } from "../../domain/agent-fqn.js";
import type { AgentManifest } from "../../domain/agent-manifest.js";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { Source, SourceError } from "../../domain/source.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export type AgentOriginConflict = {
  readonly type: "AgentOriginConflict";
  readonly fqn: string;
  readonly existingOrigin: string;
  readonly attemptedOrigin: string;
};

export const InstallAgentRequestSchema = z.object({
  origin: z.string(),
  dependencyRefs: z.object({
    skills: z.array(z.string()),
    mcps: z.array(z.string()),
    agents: z.array(z.string()),
  }),
});
export type InstallAgentRequest = z.infer<typeof InstallAgentRequestSchema>;

export const InstallAgentResponseSchema = z.object({
  id: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  disabledByUser: z.boolean(),
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  agents: z.array(z.string()),
});
export type InstallAgentResponse = z.infer<typeof InstallAgentResponseSchema>;

export type InstallAgentError = SourceError | AgentOriginConflict | DatabaseUnavailable;

export interface InstallAgentDeps {
  readonly agentSource: Source<AgentManifest>;
  readonly agentRepo: AgentRepository;
}

type Built = { agent: AgentEntity; files: ReadonlyMap<string, Buffer> };

export class InstallAgentUseCase
  implements UseCase<InstallAgentRequest, InstallAgentResponse, InstallAgentError>
{
  constructor(private readonly deps: InstallAgentDeps) {}

  execute(request: InstallAgentRequest): UseCaseResult<InstallAgentResponse, InstallAgentError> {
    return this.deps.agentSource
      .fetch(request.origin)
      .andThen(({ manifest, files }) =>
        this.buildEntity(manifest, files, request.origin, request.dependencyRefs),
      )
      .andThen(({ agent, files }) => this.deps.agentRepo.save(agent, files).map(() => agent))
      .map((agent) => ({
        id: agent.id,
        description: agent.description,
        version: agent.version,
        ...(agent.prereqs !== undefined && agent.prereqs.trim().length > 0
          ? { prereqs: agent.prereqs }
          : {}),
        prereqsAck: agent.prereqsAck,
        disabledByUser: agent.disabledByUser,
        skills: [...agent.dependencyRefs.skills],
        mcps: [...agent.dependencyRefs.mcps],
        agents: [...agent.dependencyRefs.agents],
      }));
  }

  private buildEntity(
    manifest: AgentManifest,
    files: ReadonlyMap<string, Buffer>,
    origin: string,
    dependencyRefs: AgentDependencyRefs,
  ): ResultAsync<Built, AgentOriginConflict | DatabaseUnavailable> {
    const fqn = AgentFqn.create(manifest.scope, manifest.name);
    const mint = (carriedAck: boolean, carriedDisabled: boolean): Built => {
      const agent = AgentEntity.create({
        scope: manifest.scope,
        name: manifest.name,
        origin,
        description: manifest.description,
        version: manifest.version,
        prereqs: manifest.prereqs,
        dependencyRefs,
        now: new Date().toISOString(),
      });
      if (carriedAck) agent.acknowledgePrereqs();
      if (carriedDisabled) agent.disable();
      return { agent, files };
    };
    return this.deps.agentRepo
      .get(fqn)
      .andThen((existing) =>
        existing.origin === origin
          ? okAsync(
              mint(
                existing.prereqs === manifest.prereqs ? existing.prereqsAck : false,
                existing.disabledByUser,
              ),
            )
          : errAsync<Built, AgentOriginConflict>({
              type: "AgentOriginConflict",
              fqn,
              existingOrigin: existing.origin,
              attemptedOrigin: origin,
            }),
      )
      .orElse((e) => (e.type === "AgentNotFound" ? okAsync(mint(false, false)) : errAsync(e)));
  }
}
