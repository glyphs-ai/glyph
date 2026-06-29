/**
 * Use case: read an MCP's raw client-config spec. The runtime pulls this
 * to materialise the downstream MCP host's config file. Load → project
 * the spec bytes. `McpNotFound` when the id doesn't resolve.
 */

import { z } from "zod";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type {
  DatabaseUnavailable,
  McpNotFound,
  McpRepository,
} from "../../domain/mcp-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetMcpContentRequestSchema = z.object({
  id: McpFqnSchema,
});
export type GetMcpContentRequest = z.infer<typeof GetMcpContentRequestSchema>;

export const GetMcpContentResponseSchema = z.object({
  id: z.string(),
  spec: z.string(),
});
export type GetMcpContentResponse = z.infer<typeof GetMcpContentResponseSchema>;

export type GetMcpContentError = McpNotFound | DatabaseUnavailable;

export interface GetMcpContentDeps {
  readonly mcpRepo: McpRepository;
}

export class GetMcpContentUseCase
  implements UseCase<GetMcpContentRequest, GetMcpContentResponse, GetMcpContentError>
{
  constructor(private readonly deps: GetMcpContentDeps) {}

  async execute(
    request: GetMcpContentRequest,
  ): UseCaseResult<GetMcpContentResponse, GetMcpContentError> {
    return this.deps.mcpRepo.get(request.id).map((mcp) => ({ id: mcp.id, spec: mcp.spec }));
  }
}
