import { eq } from "drizzle-orm";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import { type WorkspaceName, WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable } from "../domain/workspace-repository.js";
import type { WorkspaceQueries } from "../infrastructure/drizzle/workspace-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetWorkspaceRequestSchema = z.object({ id: WorkspaceIdSchema }).strict();
export type GetWorkspaceRequest = z.infer<typeof GetWorkspaceRequestSchema>;

export const GetWorkspaceResponseSchema = z
  .object({
    id: WorkspaceIdSchema,
    name: WorkspaceNameSchema,
    workspaceDir: z.string(),
    createdAt: z.string(),
    lastOpenedAt: z.string(),
  })
  .nullable();
export type GetWorkspaceResponse = z.infer<typeof GetWorkspaceResponseSchema>;

export type GetWorkspaceError = DatabaseUnavailable;

export interface GetWorkspaceDeps {
  readonly query: WorkspaceQueries;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Look up a workspace by id; absent rows return `null`. */
export class GetWorkspaceUseCase
  implements UseCase<GetWorkspaceRequest, GetWorkspaceResponse, GetWorkspaceError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: GetWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(request: GetWorkspaceRequest): UseCaseResult<GetWorkspaceResponse, GetWorkspaceError> {
    const { id } = GetWorkspaceRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query<GetWorkspaceResponse>(async (db) => {
        const row = await db.select().from(q.workspaces).where(eq(q.workspaces.id, id)).get();
        if (row === undefined) return null;
        return {
          id: row.id as WorkspaceId,
          name: row.name as WorkspaceName,
          workspaceDir: row.workspaceDir,
          createdAt: row.createdAt,
          lastOpenedAt: row.lastOpenedAt ?? row.createdAt,
        };
      })
      .mapErr((err) => {
        this.logger.warn({ useCase: "getWorkspace", id, err }, "tech failure");
        return err;
      });
  }
}
