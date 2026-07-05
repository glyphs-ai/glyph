import { eq } from "drizzle-orm";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogFileEntry } from "../../domain/catalog-file.js";
import { agentFiles } from "../../infrastructure/drizzle/agent-schema.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const ListAgentFilesRequestSchema = z.object({ id: AgentFqnSchema });
export type ListAgentFilesRequest = z.infer<typeof ListAgentFilesRequestSchema>;
export const ListAgentFilesResponseSchema = z.array(
  z.object({ relPath: z.string(), size: z.number() }),
);
export type ListAgentFilesResponse = CatalogFileEntry[];
export type ListAgentFilesError = DatabaseUnavailable;

export interface ListAgentFilesDeps {
  readonly queries: CatalogQueries;
}

export class ListAgentFilesUseCase
  implements UseCase<ListAgentFilesRequest, ListAgentFilesResponse, ListAgentFilesError>
{
  constructor(private readonly deps: ListAgentFilesDeps) {}

  execute(
    request: ListAgentFilesRequest,
  ): UseCaseResult<ListAgentFilesResponse, ListAgentFilesError> {
    const { id } = request;
    return this.deps.queries.query((db) =>
      db
        .select({ relPath: agentFiles.relPath, content: agentFiles.content })
        .from(agentFiles)
        .where(eq(agentFiles.agentFqn, id))
        .orderBy(agentFiles.relPath)
        .all()
        .map((row) => ({ relPath: row.relPath, size: row.content.byteLength })),
    );
  }
}
