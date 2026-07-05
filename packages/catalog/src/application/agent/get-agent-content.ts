import { and, eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { AgentNotFound, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { agentFiles } from "../../infrastructure/drizzle/agent-schema.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const ANCHOR = "AGENTS.md";

export const GetAgentContentRequestSchema = z.object({ id: AgentFqnSchema });
export type GetAgentContentRequest = z.infer<typeof GetAgentContentRequestSchema>;
export const GetAgentContentResponseSchema = z.object({ id: z.string(), content: z.string() });
export type GetAgentContentResponse = z.infer<typeof GetAgentContentResponseSchema>;
export type GetAgentContentError = AgentNotFound | DatabaseUnavailable;

export interface GetAgentContentDeps {
  readonly queries: CatalogQueries;
}

export class GetAgentContentUseCase
  implements UseCase<GetAgentContentRequest, GetAgentContentResponse, GetAgentContentError>
{
  constructor(private readonly deps: GetAgentContentDeps) {}

  execute(
    request: GetAgentContentRequest,
  ): UseCaseResult<GetAgentContentResponse, GetAgentContentError> {
    const { id } = request;
    return this.deps.queries
      .query((db) => {
        const row = db
          .select({ content: agentFiles.content })
          .from(agentFiles)
          .where(and(eq(agentFiles.agentFqn, id), eq(agentFiles.relPath, ANCHOR)))
          .get();
        return row?.content.toString("utf8");
      })
      .andThen(
        (content): UseCaseResult<GetAgentContentResponse, GetAgentContentError> =>
          content === undefined
            ? errAsync({ type: "AgentNotFound", fqn: id })
            : okAsync({ id, content }),
      );
  }
}
