import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type {
  DatabaseUnavailable,
  WorkspaceNotFound,
  WorkspaceRepository,
} from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RenameWorkspaceRequestSchema = z
  .object({ id: WorkspaceIdSchema, name: WorkspaceNameSchema })
  .strict();
export type RenameWorkspaceRequest = z.infer<typeof RenameWorkspaceRequestSchema>;

export const RenameWorkspaceResponseSchema = z.void();
export type RenameWorkspaceResponse = undefined;

export type RenameWorkspaceError = WorkspaceNotFound | DatabaseUnavailable;

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
      .get(id)
      .andThen((entity) => {
        entity.rename(name);
        return this.deps.repo.save(entity);
      })
      .map(() => {
        this.logger.debug({ useCase: "renameWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err): RenameWorkspaceError => {
        if (err.type === "WorkspaceNotFound") {
          this.logger.debug({ useCase: "renameWorkspace", err }, "rejected");
          return err;
        }
        // Every other repo failure is a tech fault. The id/path save
        // conflicts an UPDATE of a loaded aggregate can never actually
        // raise fold into DatabaseUnavailable so the contract stays narrow.
        this.logger.warn({ useCase: "renameWorkspace", err }, "tech failure");
        return err.type === "DatabaseUnavailable"
          ? err
          : { type: "DatabaseUnavailable", cause: err };
      });
  }
}
