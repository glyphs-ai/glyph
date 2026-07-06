import { desc } from "drizzle-orm";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import { type WorkspaceName, WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable } from "../domain/workspace-repository.js";
import type { WorkspaceQueries } from "../infrastructure/drizzle/workspace-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListWorkspacesRequestSchema = z.object({}).strict();
export type ListWorkspacesRequest = z.infer<typeof ListWorkspacesRequestSchema>;

// Deliberate duplication: this 5-field workspace projection is intentionally NOT
// shared with the sibling get-last-opened-workspace / get-workspace /
// register-workspace use cases that expose the same shape. Each owns its V1
// response so a later evolution of one caller never drags the others along in
// lockstep. Redundancy > coupling.
export const ListWorkspacesResponseSchema = z.array(
  z.object({
    id: WorkspaceIdSchema,
    name: WorkspaceNameSchema,
    workspaceDir: z.string(),
    createdAt: z.string(),
    lastOpenedAt: z.string(),
  }),
);
export type ListWorkspacesResponse = z.infer<typeof ListWorkspacesResponseSchema>;

export type ListWorkspacesError = DatabaseUnavailable;

export interface ListWorkspacesDeps {
  readonly query: WorkspaceQueries;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Return all registered workspaces in last-opened order. */
export class ListWorkspacesUseCase
  implements UseCase<ListWorkspacesRequest, ListWorkspacesResponse, ListWorkspacesError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: ListWorkspacesDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: ListWorkspacesRequest,
  ): UseCaseResult<ListWorkspacesResponse, ListWorkspacesError> {
    ListWorkspacesRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query<ListWorkspacesResponse>(async (db) => {
        const rows = await db
          .select()
          .from(q.workspaces)
          .orderBy(desc(q.workspaces.lastOpenedAt), desc(q.workspaces.createdAt), q.workspaces.id)
          .all();
        return rows.map((row) => ({
          id: row.id as WorkspaceId,
          name: row.name as WorkspaceName,
          workspaceDir: row.workspaceDir,
          createdAt: row.createdAt,
          lastOpenedAt: row.lastOpenedAt ?? row.createdAt,
        }));
      })
      .mapErr((err) => {
        this.logger.warn({ useCase: "listWorkspaces", err }, "tech failure");
        return err;
      });
  }
}
