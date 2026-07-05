/**
 * Use case: reverse-lookup an installed MCP by its source origin.
 *
 * Origin is matched verbatim against the stored provenance string.
 * `McpNotFound` is keyed by origin when nothing matches.
 */

import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable, McpNotFound } from "../../domain/mcp-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { mcps } from "../../infrastructure/drizzle/mcp-schema.js";
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
  readonly queries: CatalogQueries;
}

export class GetMcpByOriginUseCase
  implements UseCase<GetMcpByOriginRequest, GetMcpByOriginResponse, GetMcpByOriginError>
{
  constructor(private readonly deps: GetMcpByOriginDeps) {}

  execute(
    request: GetMcpByOriginRequest,
  ): UseCaseResult<GetMcpByOriginResponse, GetMcpByOriginError> {
    const { origin } = request;
    return this.deps.queries
      .query((db) => db.select().from(mcps).where(eq(mcps.origin, origin)).get())
      .andThen(
        (row): UseCaseResult<GetMcpByOriginResponse, GetMcpByOriginError> =>
          row === undefined
            ? errAsync({ type: "McpNotFound", fqn: origin })
            : okAsync({ id: row.fqn, origin: row.origin, spec: row.spec }),
      );
  }
}
