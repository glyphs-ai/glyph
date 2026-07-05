/**
 * Use case: read an MCP's raw client-config spec. The runtime pulls this
 * to materialise the downstream MCP host's config file. Load → project
 * the spec bytes. `McpNotFound` when the id doesn't resolve.
 */

import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { DatabaseUnavailable, McpNotFound } from "../../domain/mcp-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { mcps } from "../../infrastructure/drizzle/mcp-schema.js";
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
  readonly queries: CatalogQueries;
}

export class GetMcpContentUseCase
  implements UseCase<GetMcpContentRequest, GetMcpContentResponse, GetMcpContentError>
{
  constructor(private readonly deps: GetMcpContentDeps) {}

  execute(request: GetMcpContentRequest): UseCaseResult<GetMcpContentResponse, GetMcpContentError> {
    const { id } = request;
    return this.deps.queries
      .query((db) => db.select({ spec: mcps.spec }).from(mcps).where(eq(mcps.fqn, id)).get())
      .andThen(
        (row): UseCaseResult<GetMcpContentResponse, GetMcpContentError> =>
          row === undefined
            ? errAsync({ type: "McpNotFound", fqn: id })
            : okAsync({ id, spec: row.spec }),
      );
  }
}
