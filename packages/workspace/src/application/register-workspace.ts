import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceEntity } from "../domain/workspace-entity.js";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { ProvisioningFailed, WorkspaceProvisioner } from "../domain/workspace-provisioner.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { WorkspaceQueries } from "../infrastructure/drizzle/workspace-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/** Request body for creating a workspace; ids are minted internally. */
export const RegisterWorkspaceRequestSchema = z
  .object({
    name: WorkspaceNameSchema,
    workspaceDir: z
      .string()
      .refine((s) => s.trim().length > 0, "workspaceDir, when present, must be a non-empty string")
      .optional(),
  })
  .strict();
export type RegisterWorkspaceRequest = z.infer<typeof RegisterWorkspaceRequestSchema>;

export const RegisterWorkspaceResponseSchema = z.object({
  id: WorkspaceIdSchema,
  name: WorkspaceNameSchema,
  workspaceDir: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});
export type RegisterWorkspaceResponse = z.infer<typeof RegisterWorkspaceResponseSchema>;

/**
 * The requested `workspaceDir` is already registered to another
 * workspace. A `register`-owned business error, surfaced by the
 * pre-flight uniqueness query (SQLite constraints are no longer
 * translated — a failed INSERT is a `DatabaseUnavailable`).
 */
export type WorkspacePathConflict = {
  readonly type: "WorkspacePathConflict";
  readonly workspaceDir: string;
  /**
   * The id of the workspace already registered at this path. May be
   * absent in the rare case the row was concurrently deleted between
   * the uniqueness check and the id lookup.
   */
  readonly existingId: WorkspaceId | undefined;
};

export type RegisterWorkspaceError =
  | WorkspacePathConflict
  | DatabaseUnavailable
  | ProvisioningFailed;

export interface RegisterWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly query: WorkspaceQueries;
  readonly provisioner: WorkspaceProvisioner;
  /** Parent directory for auto-created workspace directories. */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Create the workspace root directory, then insert the registry row.
 * Pre-flight path checks improve UX before storage writes.
 */
export class RegisterWorkspaceUseCase
  implements UseCase<RegisterWorkspaceRequest, RegisterWorkspaceResponse, RegisterWorkspaceError>
{
  private readonly logger: Logger;
  constructor(private readonly deps: RegisterWorkspaceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: RegisterWorkspaceRequest,
  ): UseCaseResult<RegisterWorkspaceResponse, RegisterWorkspaceError> {
    const parsed = RegisterWorkspaceRequestSchema.parse(request);
    // Cast at the mint boundary: `randomUUID()` satisfies the UUID brand.
    const id = randomUUID() as WorkspaceId;
    const workspaceDir =
      parsed.workspaceDir === undefined
        ? path.join(this.deps.defaultWorkspaceParent, id)
        : path.resolve(parsed.workspaceDir);

    this.logger.debug({ useCase: "registerWorkspace", id, workspaceDir }, "executing");

    const q = this.deps.query;
    return q
      .query<{ id: string } | undefined>((db) =>
        db
          .select({ id: q.workspaces.id })
          .from(q.workspaces)
          .where(eq(q.workspaces.workspaceDir, workspaceDir))
          .get(),
      )
      .andThen<undefined, RegisterWorkspaceError>((existing) =>
        existing
          ? errAsync({
              type: "WorkspacePathConflict" as const,
              workspaceDir,
              existingId: existing.id as WorkspaceId,
            })
          : okAsync(undefined),
      )
      .andThen(() => this.deps.provisioner.provision(workspaceDir))
      .andThen<WorkspaceEntity, RegisterWorkspaceError>(() => {
        const entity = WorkspaceEntity.create({
          id,
          name: parsed.name,
          workspaceDir,
          now: new Date().toISOString(),
        });
        return this.deps.repo.save(entity).map(() => entity);
      })
      .map((entity): RegisterWorkspaceResponse => {
        this.logger.debug({ useCase: "registerWorkspace", id: entity.id }, "executed");
        return {
          id: entity.id,
          name: entity.name,
          workspaceDir: entity.workspaceDir,
          createdAt: entity.createdAt,
          // lastOpenedAt is non-null after create() seeds it to now.
          lastOpenedAt: entity.lastOpenedAt!,
        };
      })
      .mapErr((err) => {
        if (err.type === "DatabaseUnavailable" || err.type === "ProvisioningFailed") {
          this.logger.warn({ useCase: "registerWorkspace", err }, "tech failure");
        } else {
          this.logger.debug({ useCase: "registerWorkspace", err }, "rejected");
        }
        return err;
      });
  }
}
