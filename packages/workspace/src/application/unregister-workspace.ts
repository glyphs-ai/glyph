import { errAsync, okAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import type { ProvisioningFailed, WorkspaceProvisioner } from "../domain/workspace-provisioner.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const UnregisterWorkspaceRequestSchema = z
  .object({
    id: WorkspaceIdSchema,
    purge: z.boolean().optional(),
  })
  .strict();
export type UnregisterWorkspaceRequest = z.infer<typeof UnregisterWorkspaceRequestSchema>;

export const UnregisterWorkspaceResponseSchema = z.void();
export type UnregisterWorkspaceResponse = undefined;

export type UnregisterWorkspaceError = ProvisioningFailed | DatabaseUnavailable;

export interface UnregisterWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly provisioner: WorkspaceProvisioner;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Remove a workspace from the registry. Unknown ids succeed. With
 * `purge: true`, managed subdirectories are removed before the row is
 * deleted so cleanup still has the workspace path.
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
    const { id, purge = false } = UnregisterWorkspaceRequestSchema.parse(request);
    this.logger.debug({ useCase: "unregisterWorkspace", id, purge }, "executing");
    return this.deps.repo
      .get(id)
      .andThen((existing) => {
        const cleanup = purge
          ? this.deps.provisioner.teardown(existing.workspaceDir)
          : okAsync<void, ProvisioningFailed>(undefined);
        return cleanup.andThen(() => this.deps.repo.delete(id));
      })
      .orElse((err) =>
        // Unknown id ⇒ idempotent success (the row is already gone).
        err.type === "WorkspaceNotFound"
          ? okAsync<void, UnregisterWorkspaceError>(undefined)
          : errAsync<void, UnregisterWorkspaceError>(err),
      )
      .map(() => {
        this.logger.debug({ useCase: "unregisterWorkspace", id }, "executed");
        return undefined;
      })
      .mapErr((err) => {
        if (err.type === "DatabaseUnavailable" || err.type === "ProvisioningFailed") {
          this.logger.warn({ useCase: "unregisterWorkspace", err }, "tech failure");
        }
        return err;
      });
  }
}
