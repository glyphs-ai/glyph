import { errAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import type {
  DatabaseUnavailable,
  WorkspaceNotRegistered,
  WorkspaceRepository,
} from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const OpenWorkspaceRequestSchema = z.object({ id: WorkspaceIdSchema }).strict();
export type OpenWorkspaceRequest = z.infer<typeof OpenWorkspaceRequestSchema>;

export const OpenWorkspaceResponseSchema = z.void();
export type OpenWorkspaceResponse = undefined;

export type OpenWorkspaceError = WorkspaceNotRegistered | DatabaseUnavailable;

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
      .findById(id)
      .andThen<void, OpenWorkspaceError>((entity) => {
        if (!entity) return errAsync({ type: "WorkspaceNotRegistered" as const, id });
        entity.markOpened(new Date());
        return this.deps.repo.save(entity);
      })
      .map(() => {
        this.logger.debug({ useCase: "openWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err) => {
        if (err.type === "DatabaseUnavailable") {
          this.logger.warn({ useCase: "openWorkspace", err }, "tech failure");
        } else {
          this.logger.debug({ useCase: "openWorkspace", err }, "rejected");
        }
        return err;
      });
  }
}
