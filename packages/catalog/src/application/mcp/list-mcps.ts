import { ok, safeTry } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const McpSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
});

export const ListMcpsRequestSchema = z.object({});
export type ListMcpsRequest = z.infer<typeof ListMcpsRequestSchema>;
export const ListMcpsResponseSchema = z.array(McpSchema);
export type ListMcpsResponse = z.infer<typeof ListMcpsResponseSchema>;
export type ListMcpsError = DatabaseUnavailable;
export interface ListMcpsDeps {
  readonly mcpRepo: McpRepository;
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
}

export class ListMcpsUseCase implements UseCase<ListMcpsRequest, ListMcpsResponse, ListMcpsError> {
  constructor(private readonly deps: ListMcpsDeps) {}

  execute(_request: ListMcpsRequest): UseCaseResult<ListMcpsResponse, ListMcpsError> {
    const deps = this.deps;
    return safeTry<ListMcpsResponse, ListMcpsError>(async function* () {
      const mcps = yield* deps.mcpRepo.list();
      const agents = yield* deps.agentRepo.list();
      const skills = yield* deps.skillRepo.list();
      const referencedMcpFqns = new Set<string>();
      for (const agent of agents) {
        for (const fqn of agent.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
      }
      for (const skill of skills) {
        for (const fqn of skill.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
      }
      return ok(
        mcps.map((mcp) => ({
          fqn: mcp.fqn,
          origin: mcp.origin,
          orphaned: !referencedMcpFqns.has(mcp.fqn),
          installedAt: mcp.installedAt,
          updatedAt: mcp.updatedAt,
        })),
      );
    });
  }
}
