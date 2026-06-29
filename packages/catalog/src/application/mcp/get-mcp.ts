import { err, ok } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { McpNotFound, McpRepository } from "../../domain/mcp-repository.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const McpSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
});
type Mcp = z.infer<typeof McpSchema>;

export const GetMcpRequestSchema = z.object({ id: McpFqnSchema });
export type GetMcpRequest = z.infer<typeof GetMcpRequestSchema>;
export const GetMcpResponseSchema = McpSchema;
export type GetMcpResponse = Mcp;
export type GetMcpError = McpNotFound | DatabaseUnavailable;
export interface GetMcpDeps {
  readonly mcpRepo: McpRepository;
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
}

export class GetMcpUseCase implements UseCase<GetMcpRequest, GetMcpResponse, GetMcpError> {
  constructor(private readonly deps: GetMcpDeps) {}

  async execute(request: GetMcpRequest): UseCaseResult<GetMcpResponse, GetMcpError> {
    const mcp = await this.deps.mcpRepo.get(request.id);
    if (mcp.isErr()) {
      return err(mcp.error);
    }
    const agents = await this.deps.agentRepo.list();
    if (agents.isErr()) return err(agents.error);
    const skills = await this.deps.skillRepo.list();
    if (skills.isErr()) return err(skills.error);
    const referencedMcpFqns = new Set<string>();
    for (const agent of agents.value) {
      for (const fqn of agent.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    for (const skill of skills.value) {
      for (const fqn of skill.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    return ok({
      fqn: mcp.value.fqn,
      origin: mcp.value.origin,
      orphaned: !referencedMcpFqns.has(mcp.value.fqn),
      installedAt: mcp.value.installedAt,
      updatedAt: mcp.value.updatedAt,
    });
  }
}
