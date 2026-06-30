/**
 * Use case: reverse-lookup an installed MCP by its source origin.
 *
 * Origin is matched verbatim against the stored provenance string.
 * `McpNotFound` is keyed by origin when nothing matches.
 */

import { z } from "zod";
import type {
  DatabaseUnavailable,
  McpNotFound,
  McpRepository,
} from "../../domain/mcp-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetMcpByOriginRequestSchema = z.object({
  origin: z.string(),
});
export type GetMcpByOriginRequest = z.infer<typeof GetMcpByOriginRequestSchema>;

export const GetMcpByOriginResponseSchema = z.object({
  id: z.string(),
  origin: z.string(),
  spec: z.string(),
});
export type GetMcpByOriginResponse = z.infer<typeof GetMcpByOriginResponseSchema>;

export type GetMcpByOriginError = McpNotFound | DatabaseUnavailable;

export interface GetMcpByOriginDeps {
  readonly mcpRepo: McpRepository;
}

export class GetMcpByOriginUseCase
  implements UseCase<GetMcpByOriginRequest, GetMcpByOriginResponse, GetMcpByOriginError>
{
  constructor(private readonly deps: GetMcpByOriginDeps) {}

  execute(
    request: GetMcpByOriginRequest,
  ): UseCaseResult<GetMcpByOriginResponse, GetMcpByOriginError> {
    return this.deps.mcpRepo
      .getByOrigin(request.origin)
      .map((mcp) => ({ id: mcp.id, origin: mcp.origin, spec: mcp.spec }));
  }
}
