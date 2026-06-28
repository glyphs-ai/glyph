import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetLastOpenedWorkspaceRequestSchema = z.object({}).strict();
export type GetLastOpenedWorkspaceRequest = z.infer<typeof GetLastOpenedWorkspaceRequestSchema>;

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
  readonly repo: WorkspaceRepository;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Return the most-recently-opened workspace (highest `lastOpenedAt`),
 * or `null` when the registry is empty. Drives the dashboard's
 * default-workspace pick on cold launch.
 */
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
    return this.deps.repo
      .findLastOpened()
      .map((entity): GetLastOpenedWorkspaceResponse => {
        if (!entity) return null;
        return {
          id: entity.id,
          name: entity.name,
          workspaceDir: entity.workspaceDir,
          createdAt: entity.createdAt,
          lastOpenedAt: entity.lastOpenedAt ?? entity.createdAt,
        };
      })
      .mapErr((err) => {
        this.logger.warn({ useCase: "getLastOpenedWorkspace", err }, "tech failure");
        return err;
      });
  }
}
