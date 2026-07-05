/**
 * Use case: uninstall an MCP. Refuses to delete an MCP that an installed
 * agent or skill still depends on (deleting it would dangle a dep edge).
 * The guard reads the agent + skill mcp-dep edge tables through the read-side
 * queries seam. `McpNotFound` when the fqn doesn't resolve; `HasDependents`
 * when something still references it.
 */

import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type {
  DatabaseUnavailable,
  McpNotFound,
  McpRepository,
} from "../../domain/mcp-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedMcpFqns } from "./mcp-reads.js";

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
  readonly queries: CatalogQueries;
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
      const referenced = yield* deps.queries.query((db) => collectReferencedMcpFqns(db).has(fqn));
      if (referenced) {
        return err<UninstallMcpResponse, UninstallMcpError>({ type: "HasDependents", fqn });
      }
      yield* deps.mcpRepo.delete(fqn);
      return ok<UninstallMcpResponse, UninstallMcpError>({ id: fqn });
    });
  }
}
