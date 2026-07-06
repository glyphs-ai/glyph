import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/mcp-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { mcps } from "../../infrastructure/drizzle/mcp-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedMcpFqns } from "./mcp-reads.js";

const listMcpsEntry = z.object({
  fqn: z.string(),
  origin: z.string(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
});

export const ListMcpsRequestSchema = z.object({});
export type ListMcpsRequest = z.infer<typeof ListMcpsRequestSchema>;
export const ListMcpsResponseSchema = z.array(listMcpsEntry);
export type ListMcpsResponse = z.infer<typeof ListMcpsResponseSchema>;
export type ListMcpsError = DatabaseUnavailable;
export interface ListMcpsDeps {
  readonly queries: CatalogQueries;
}

export class ListMcpsUseCase implements UseCase<ListMcpsRequest, ListMcpsResponse, ListMcpsError> {
  constructor(private readonly deps: ListMcpsDeps) {}

  execute(_request: ListMcpsRequest): UseCaseResult<ListMcpsResponse, ListMcpsError> {
    return this.deps.queries.query((db) => {
      const referenced = collectReferencedMcpFqns(db);
      return db
        .select()
        .from(mcps)
        .orderBy(mcps.fqn)
        .all()
        .map((row) => ({
          fqn: row.fqn,
          origin: row.origin,
          orphaned: !referenced.has(row.fqn),
          installedAt: row.installedAt,
          updatedAt: row.updatedAt,
        }));
    });
  }
}
