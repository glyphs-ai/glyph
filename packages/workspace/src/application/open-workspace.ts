import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  WorkspaceNotFound,
  WorkspaceRepository,
} from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const OpenWorkspaceRequestSchema = z.object({ id: WorkspaceIdSchema }).strict();
export type OpenWorkspaceRequest = z.infer<typeof OpenWorkspaceRequestSchema>;

export const OpenWorkspaceResponseSchema = z.void();
export type OpenWorkspaceResponse = undefined;

export type OpenWorkspaceError = WorkspaceNotFound | DatabaseUnavailable;

export interface OpenWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/** Mark a workspace as opened by updating `lastOpenedAt`. */
export class OpenWorkspaceUseCase
  implements UseCase<OpenWorkspaceRequest, OpenWorkspaceResponse, OpenWorkspaceError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: OpenWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(request: OpenWorkspaceRequest): UseCaseResult<OpenWorkspaceResponse, OpenWorkspaceError> {
    const { id } = OpenWorkspaceRequestSchema.parse(request);
    this.logger.debug({ useCase: "openWorkspace", id }, "executing");
    return this.deps.repo
      .get(id)
      .andThen((entity) => {
        entity.markOpened(new Date());
        return this.deps.repo.save(entity);
      })
      .map(() => {
        this.logger.debug({ useCase: "openWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err): OpenWorkspaceError => {
        if (err.type === "WorkspaceNotFound") {
          this.logger.debug({ useCase: "openWorkspace", err }, "rejected");
          return err;
        }
        // Anything past WorkspaceNotFound is an infrastructure fault: the
        // remaining get/save errors are all DatabaseUnavailable, so log it
        // and return it (the fallback coercion keeps the error union at
        // WorkspaceNotFound | DatabaseUnavailable).
        this.logger.warn({ useCase: "openWorkspace", err }, "tech failure");
        return err.type === "DatabaseUnavailable"
          ? err
          : { type: "DatabaseUnavailable", cause: err };
      });
  }
}
