import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ListWorkspacesRequestSchema = z.object({}).strict();
export type ListWorkspacesRequest = z.infer<typeof ListWorkspacesRequestSchema>;

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
  readonly repo: WorkspaceRepository;
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
    return this.deps.repo
      .findAllByLastOpened()
      .map(
        (entities): ListWorkspacesResponse =>
          entities.map((entity) => ({
            id: entity.id,
            name: entity.name,
            workspaceDir: entity.workspaceDir,
            createdAt: entity.createdAt,
            lastOpenedAt: entity.lastOpenedAt ?? entity.createdAt,
          })),
      )
      .mapErr((err) => {
        this.logger.warn({ useCase: "listWorkspaces", err }, "tech failure");
        return err;
      });
  }
}
