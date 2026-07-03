import { desc } from "drizzle-orm";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import type { DatabaseUnavailable } from "../domain/workspace-repository.js";
import type { WorkspaceQueries } from "../infrastructure/drizzle/workspace-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetLastOpenedWorkspaceIdRequestSchema = z.object({}).strict();
export type GetLastOpenedWorkspaceIdRequest = z.infer<typeof GetLastOpenedWorkspaceIdRequestSchema>;

export const GetLastOpenedWorkspaceIdResponseSchema = z.object({
  id: WorkspaceIdSchema.nullable(),
});
export type GetLastOpenedWorkspaceIdResponse = z.infer<
  typeof GetLastOpenedWorkspaceIdResponseSchema
>;

export type GetLastOpenedWorkspaceIdError = DatabaseUnavailable;

export interface GetLastOpenedWorkspaceIdDeps {
  readonly query: WorkspaceQueries;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Return the last-opened workspace id, or `null` when empty. */
export class GetLastOpenedWorkspaceIdUseCase
  implements
    UseCase<
      GetLastOpenedWorkspaceIdRequest,
      GetLastOpenedWorkspaceIdResponse,
      GetLastOpenedWorkspaceIdError
    >
{
  private readonly logger: Logger;
  constructor(private readonly deps: GetLastOpenedWorkspaceIdDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: GetLastOpenedWorkspaceIdRequest,
  ): UseCaseResult<GetLastOpenedWorkspaceIdResponse, GetLastOpenedWorkspaceIdError> {
    GetLastOpenedWorkspaceIdRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query<GetLastOpenedWorkspaceIdResponse>(async (db) => {
        const row = await db
          .select({ id: q.workspaces.id })
          .from(q.workspaces)
          .orderBy(desc(q.workspaces.lastOpenedAt), desc(q.workspaces.createdAt), q.workspaces.id)
          .limit(1)
          .get();
        return { id: row === undefined ? null : (row.id as WorkspaceId) };
      })
      .mapErr((err) => {
        this.logger.warn({ useCase: "getLastOpenedWorkspaceId", err }, "tech failure");
        return err;
      });
  }
}
