import { errAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type {
  DatabaseUnavailable,
  WorkspaceNotRegistered,
  WorkspaceRepository,
} from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RenameWorkspaceRequestSchema = z
  .object({ id: WorkspaceIdSchema, name: WorkspaceNameSchema })
  .strict();
export type RenameWorkspaceRequest = z.infer<typeof RenameWorkspaceRequestSchema>;

export const RenameWorkspaceResponseSchema = z.void();
export type RenameWorkspaceResponse = undefined;

export type RenameWorkspaceError = WorkspaceNotRegistered | DatabaseUnavailable;

export interface RenameWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Update a workspace's display name. */
export class RenameWorkspaceUseCase
  implements UseCase<RenameWorkspaceRequest, RenameWorkspaceResponse, RenameWorkspaceError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: RenameWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: RenameWorkspaceRequest,
  ): UseCaseResult<RenameWorkspaceResponse, RenameWorkspaceError> {
    const { id, name } = RenameWorkspaceRequestSchema.parse(request);
    this.logger.debug({ useCase: "renameWorkspace", id }, "executing");
    return this.deps.repo
      .findById(id)
      .andThen<void, RenameWorkspaceError>((entity) => {
        if (!entity) return errAsync({ type: "WorkspaceNotRegistered" as const, id });
        entity.rename(name);
        return this.deps.repo.save(entity);
      })
      .map(() => {
        this.logger.debug({ useCase: "renameWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err) => {
        if (err.type === "DatabaseUnavailable") {
          this.logger.warn({ useCase: "renameWorkspace", err }, "tech failure");
        } else {
          this.logger.debug({ useCase: "renameWorkspace", err }, "rejected");
        }
        return err;
      });
  }
}
