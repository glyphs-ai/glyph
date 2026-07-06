import { desc } from "drizzle-orm";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import { type WorkspaceName, WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable } from "../domain/workspace-repository.js";
import type { WorkspaceQueries } from "../infrastructure/drizzle/workspace-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetLastOpenedWorkspaceRequestSchema = z.object({}).strict();
export type GetLastOpenedWorkspaceRequest = z.infer<typeof GetLastOpenedWorkspaceRequestSchema>;

// Deliberate duplication: this 5-field workspace projection is intentionally NOT
// shared with the sibling get-workspace / list-workspaces / register-workspace
// use cases that expose the same shape. Each owns its V1 response so a later
// evolution of one caller never drags the others along in lockstep.
// Redundancy > coupling.
export const GetLastOpenedWorkspaceResponseSchema = z
  .object({
    id: WorkspaceIdSchema,
    name: WorkspaceNameSchema,
    workspaceDir: z.string(),
    createdAt: z.string(),
    lastOpenedAt: z.string(),
  })
  .nullable();
export type GetLastOpenedWorkspaceResponse = z.infer<typeof GetLastOpenedWorkspaceResponseSchema>;

export type GetLastOpenedWorkspaceError = DatabaseUnavailable;

export interface GetLastOpenedWorkspaceDeps {
  readonly query: WorkspaceQueries;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Return the most-recently-opened workspace, or `null` when empty. */
export class GetLastOpenedWorkspaceUseCase
  implements
    UseCase<
      GetLastOpenedWorkspaceRequest,
      GetLastOpenedWorkspaceResponse,
      GetLastOpenedWorkspaceError
    >
{
  private readonly logger: Logger;
  constructor(private readonly deps: GetLastOpenedWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: GetLastOpenedWorkspaceRequest,
  ): UseCaseResult<GetLastOpenedWorkspaceResponse, GetLastOpenedWorkspaceError> {
    GetLastOpenedWorkspaceRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query<GetLastOpenedWorkspaceResponse>(async (db) => {
        const row = await db
          .select()
          .from(q.workspaces)
          .orderBy(desc(q.workspaces.lastOpenedAt), desc(q.workspaces.createdAt), q.workspaces.id)
          .limit(1)
          .get();
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
        this.logger.warn({ useCase: "getLastOpenedWorkspace", err }, "tech failure");
        return err;
      });
  }
}
