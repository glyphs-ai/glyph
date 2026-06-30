/**
 * Use case: uninstall an MCP. Refuses to delete an MCP that an installed
 * agent or skill still depends on (deleting it would dangle a dep edge).
 * The guard forward-scans installed agents + skills for references to this
 * fqn — an application-layer read across sibling aggregates, never a
 * cross-aggregate table read in the repo. `McpNotFound` when the fqn
 * doesn't resolve; `HasDependents` when something still references it.
 */

import { err, ok, safeTry } from "neverthrow";
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

  execute(request: UninstallMcpRequest): UseCaseResult<UninstallMcpResponse, UninstallMcpError> {
    const fqn = request.id;
    const deps = this.deps;
    return safeTry<UninstallMcpResponse, UninstallMcpError>(async function* () {
      yield* deps.mcpRepo.get(fqn);
      const byAgent = yield* deps.agentRepo.existsUsingMcp(fqn);
      const bySkill = yield* deps.skillRepo.existsUsingMcp(fqn);
      if (byAgent || bySkill) {
        return err<UninstallMcpResponse, UninstallMcpError>({ type: "HasDependents", fqn });
      }
      yield* deps.mcpRepo.delete(fqn);
      return ok<UninstallMcpResponse, UninstallMcpError>({ id: fqn });
    });
  }
}
