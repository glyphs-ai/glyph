import { randomUUID } from "node:crypto";
import path from "node:path";
import { errAsync, okAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceEntity } from "../domain/workspace-entity.js";
import { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
import { WorkspaceNameSchema } from "../domain/workspace-name.js";
import type { ProvisioningFailed, WorkspaceProvisioner } from "../domain/workspace-provisioner.js";
import type {
  DatabaseUnavailable,
  WorkspaceIdConflict,
  WorkspacePathConflict,
  WorkspaceRepository,
} from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/**
 * Request body for `RegisterWorkspaceUseCase`. `name` is required;
 * `workspaceDir` is optional — when omitted the use-case mints
 * `<defaultWorkspaceParent>/<uuid>/`. `id` is server-minted inside
 * the use-case, never supplied by the caller (hence `.strict()`).
 */
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

export type RegisterWorkspaceError =
  | WorkspaceIdConflict
  | WorkspacePathConflict
  | DatabaseUnavailable
  | ProvisioningFailed;

export interface RegisterWorkspaceDeps {
  readonly repo: WorkspaceRepository;
  readonly provisioner: WorkspaceProvisioner;
  /**
   * Absolute directory under which `register({ workspaceDir: undefined })`
   * mints `<defaultWorkspaceParent>/<uuid>/`. Injected by the host so
   * the package owns the directory-layout convention while the host
   * owns the root location (`$GLYPH_HOME`).
   */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Mint a fresh workspace and persist it.
 *
 * Order: pre-flight `findByPath` (best-effort UX) → `provision` (FS
 * side-effect, idempotent) → `insert` (DB write; SQLite constraint
 * violations translate to `WorkspaceIdConflict` /
 * `WorkspacePathConflict` at the adapter boundary so the result
 * surfaces deterministically even when the pre-flight races).
 *
 * Provision-before-insert means a crash mid-register leaves an empty
 * skeleton instead of a registry row pointing at a non-existent
 * directory; retries are idempotent.
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
    // Cast at the mint boundary: `randomUUID()` produces a string we
    // know to be a valid UUID, so it satisfies the `WorkspaceId`
    // brand by construction — re-parsing through the schema would be
    // wasted work. This is the only place in the package allowed to
    // mint a `WorkspaceId` without going through schema parse.
    const id = randomUUID() as WorkspaceId;
    const workspaceDir =
      parsed.workspaceDir === undefined
        ? path.join(this.deps.defaultWorkspaceParent, id)
        : path.resolve(parsed.workspaceDir);

    this.logger.debug({ useCase: "registerWorkspace", id, workspaceDir }, "executing");

    return this.deps.repo
      .findByPath(workspaceDir)
      .andThen<undefined, RegisterWorkspaceError>((existing) =>
        existing
          ? errAsync({
              type: "WorkspacePathConflict" as const,
              workspaceDir,
              existingId: existing.id,
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
        return this.deps.repo.insert(entity).map(() => entity);
      })
      .map((entity): RegisterWorkspaceResponse => {
        this.logger.debug({ useCase: "registerWorkspace", id: entity.id }, "executed");
        // lastOpenedAt is non-null here — `create` seeds it to `now`.
        return {
          id: entity.id,
          name: entity.name,
          workspaceDir: entity.workspaceDir,
          createdAt: entity.createdAt,
          // biome-ignore lint/style/noNonNullAssertion: create() seeds lastOpenedAt to now.
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
