import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
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
  readonly repo: WorkspaceRepository;
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
    return this.deps.repo
      .findById(id)
      .map((entity): GetWorkspaceResponse => {
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
        this.logger.warn({ useCase: "getWorkspace", id, err }, "tech failure");
        return err;
      });
  }
}
