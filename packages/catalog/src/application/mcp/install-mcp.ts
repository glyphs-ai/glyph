/**
 * Use case: install an MCP from a source origin.
 *
 * MCPs are single-file leaves. Install flow:
 *   1. `mcpSource.load(origin)`  → ResultAsync<McpManifest, SourceError>.
 *      The source validates the fqn grammar via `McpFqnSchema`.
 *   2. origin-conflict guard      → reads `mcpRepo.get(fqn)`; a
 *      `McpNotFound` means "fresh install" (ok), a same-origin hit means
 *      "reinstall" (ok), a different-origin hit is `McpOriginConflict`.
 *   3. `McpEntity.create(...)`    → the entity trusts the branded fqn.
 *   4. `mcpRepo.save(mcp)`        → ResultAsync<void, DatabaseUnavailable>.
 *   5. project to the response DTO.
 *
 * The id is the manifest's spec name verbatim.
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import { McpEntity } from "../../domain/mcp-entity.js";
import type { McpManifest } from "../../domain/mcp-manifest.js";
import type { DatabaseUnavailable, McpRepository } from "../../domain/mcp-repository.js";
import type { Source, SourceError } from "../../domain/source.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

/**
 * Reinstalling an existing MCP under a different origin. Identity (name)
 * collisions across origins are rejected — switching origins requires an
 * explicit delete + reinstall. Raised here (cross-row check), not by the
 * entity.
 */
export type McpOriginConflict = {
  readonly type: "McpOriginConflict";
  readonly fqn: string;
  readonly existingOrigin: string;
  readonly attemptedOrigin: string;
};

export const InstallMcpRequestSchema = z.object({
  origin: z.string(),
});
export type InstallMcpRequest = z.infer<typeof InstallMcpRequestSchema>;

export const InstallMcpResponseSchema = z.object({
  id: z.string(),
  origin: z.string(),
});
export type InstallMcpResponse = z.infer<typeof InstallMcpResponseSchema>;

export type InstallMcpError = SourceError | McpOriginConflict | DatabaseUnavailable;

export interface InstallMcpDeps {
  readonly mcpSource: Source<McpManifest>;
  readonly mcpRepo: McpRepository;
}

export class InstallMcpUseCase
  implements UseCase<InstallMcpRequest, InstallMcpResponse, InstallMcpError>
{
  constructor(private readonly deps: InstallMcpDeps) {}

  async execute(request: InstallMcpRequest): UseCaseResult<InstallMcpResponse, InstallMcpError> {
    return this.deps.mcpSource
      .load(request.origin)
      .andThen((manifest) => this.guardOrigin(manifest, request.origin))
      .map((manifest) =>
        McpEntity.create({
          fqn: manifest.name,
          origin: request.origin,
          spec: manifest.spec,
          now: new Date().toISOString(),
        }),
      )
      .andThen((mcp) => this.deps.mcpRepo.save(mcp).map(() => mcp))
      .map((mcp) => ({ id: mcp.id, origin: mcp.origin }));
  }

  private guardOrigin(
    manifest: McpManifest,
    origin: string,
  ): ResultAsync<McpManifest, McpOriginConflict | DatabaseUnavailable> {
    return this.deps.mcpRepo
      .get(manifest.name)
      .andThen((existing) =>
        existing.origin === origin
          ? okAsync(manifest)
          : errAsync<McpManifest, McpOriginConflict>({
              type: "McpOriginConflict",
              fqn: manifest.name,
              existingOrigin: existing.origin,
              attemptedOrigin: origin,
            }),
      )
      .orElse((e) => (e.type === "McpNotFound" ? okAsync(manifest) : errAsync(e)));
  }
}
