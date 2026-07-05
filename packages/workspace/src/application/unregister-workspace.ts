import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const UnregisterWorkspaceRequestSchema = z
  .object({
    id: WorkspaceIdSchema,
  })
  .strict();
export type UnregisterWorkspaceRequest = z.infer<typeof UnregisterWorkspaceRequestSchema>;

export const UnregisterWorkspaceResponseSchema = z.void();
export type UnregisterWorkspaceResponse = undefined;

export type UnregisterWorkspaceError = DatabaseUnavailable;

export interface UnregisterWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Remove a workspace from the registry (metadata only). Unknown ids
 * succeed (the SQL delete is a no-op). On-disk files under `workspaceDir`
 * are left untouched — each package owns the lifecycle of its own subdir.
 */
export class UnregisterWorkspaceUseCase
  implements
    UseCase<UnregisterWorkspaceRequest, UnregisterWorkspaceResponse, UnregisterWorkspaceError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: UnregisterWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: UnregisterWorkspaceRequest,
  ): UseCaseResult<UnregisterWorkspaceResponse, UnregisterWorkspaceError> {
    const { id } = UnregisterWorkspaceRequestSchema.parse(request);
    this.logger.debug({ useCase: "unregisterWorkspace", id }, "executing");
    return this.deps.repo
      .delete(id)
      .map(() => {
        this.logger.debug({ useCase: "unregisterWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err) => {
        this.logger.warn({ useCase: "unregisterWorkspace", err }, "tech failure");
        return err;
      });
  }
}
