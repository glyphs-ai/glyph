import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { agentFiles } from "../../infrastructure/drizzle/agent-schema.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetAgentFileRequestSchema = z.object({ id: AgentFqnSchema, relPath: z.string() });
export type GetAgentFileRequest = z.infer<typeof GetAgentFileRequestSchema>;
export type GetAgentFileResponse = Buffer | null;
export type GetAgentFileError = DatabaseUnavailable;

export interface GetAgentFileDeps {
  readonly queries: CatalogQueries;
}

export class GetAgentFileUseCase
  implements UseCase<GetAgentFileRequest, GetAgentFileResponse, GetAgentFileError>
{
  constructor(private readonly deps: GetAgentFileDeps) {}

  execute(request: GetAgentFileRequest): UseCaseResult<GetAgentFileResponse, GetAgentFileError> {
    const { id, relPath } = request;
    return this.deps.queries.query((db) => {
      const row = db
        .select({ content: agentFiles.content })
        .from(agentFiles)
        .where(and(eq(agentFiles.agentFqn, id), eq(agentFiles.relPath, relPath)))
        .get();
      return row?.content ?? null;
    });
  }
}
