import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { DatabaseUnavailable, McpNotFound } from "../../domain/mcp-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { mcps } from "../../infrastructure/drizzle/mcp-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedMcpFqns } from "./mcp-reads.js";

export const GetMcpRequestSchema = z.object({ id: McpFqnSchema });
export type GetMcpRequest = z.infer<typeof GetMcpRequestSchema>;
export const GetMcpResponseSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
});
export type GetMcpResponse = z.infer<typeof GetMcpResponseSchema>;
export type GetMcpError = McpNotFound | DatabaseUnavailable;
export interface GetMcpDeps {
  readonly queries: CatalogQueries;
}

export class GetMcpUseCase implements UseCase<GetMcpRequest, GetMcpResponse, GetMcpError> {
  constructor(private readonly deps: GetMcpDeps) {}

  execute(request: GetMcpRequest): UseCaseResult<GetMcpResponse, GetMcpError> {
    const { id } = request;
    return this.deps.queries
      .query((db): GetMcpResponse | undefined => {
        const row = db.select().from(mcps).where(eq(mcps.fqn, id)).get();
        if (row === undefined) return undefined;
        const referenced = collectReferencedMcpFqns(db);
        return {
          fqn: row.fqn,
          origin: row.origin,
          orphaned: !referenced.has(row.fqn),
          installedAt: row.installedAt,
          updatedAt: row.updatedAt,
        };
      })
      .andThen(
        (dto): UseCaseResult<GetMcpResponse, GetMcpError> =>
          dto === undefined ? errAsync({ type: "McpNotFound", fqn: id }) : okAsync(dto),
      );
  }
}
