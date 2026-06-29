/**
 * Use case: uninstall an MCP. Refuses to delete an MCP that an installed
 * agent or skill still depends on (deleting it would dangle a dep edge).
 * The guard forward-scans installed agents + skills for references to this
 * fqn — an application-layer read across sibling aggregates, never a
 * cross-aggregate table read in the repo. `McpNotFound` when the fqn
 * doesn't resolve; `HasDependents` when something still references it.
 */

import { err } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { McpNotFound, McpRepository } from "../../domain/mcp-repository.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const UninstallMcpRequestSchema = z.object({
  id: McpFqnSchema,
});
export type UninstallMcpRequest = z.infer<typeof UninstallMcpRequestSchema>;

export const UninstallMcpResponseSchema = z.object({
  id: z.string(),
});
export type UninstallMcpResponse = z.infer<typeof UninstallMcpResponseSchema>;

export type HasDependents = {
  readonly type: "HasDependents";
  readonly fqn: string;
};

export type UninstallMcpError = McpNotFound | HasDependents | DatabaseUnavailable;

export interface UninstallMcpDeps {
  readonly mcpRepo: McpRepository;
  readonly agentRepo: AgentRepository;
  readonly skillRepo: SkillRepository;
}

export class UninstallMcpUseCase
  implements UseCase<UninstallMcpRequest, UninstallMcpResponse, UninstallMcpError>
{
  constructor(private readonly deps: UninstallMcpDeps) {}

  async execute(
    request: UninstallMcpRequest,
  ): UseCaseResult<UninstallMcpResponse, UninstallMcpError> {
    const fqn = request.id;
    const found = await this.deps.mcpRepo.get(fqn);
    if (found.isErr()) return err(found.error);

    const byAgent = await this.deps.agentRepo.existsUsingMcp(fqn);
    if (byAgent.isErr()) return err(byAgent.error);
    const bySkill = await this.deps.skillRepo.existsUsingMcp(fqn);
    if (bySkill.isErr()) return err(bySkill.error);
    if (byAgent.value || bySkill.value) return err({ type: "HasDependents", fqn });

    return this.deps.mcpRepo.delete(fqn).map(() => ({ id: fqn }));
  }
}
