import path from "node:path";
import type { Logger } from "pino";
import { GetLastOpenedWorkspaceUseCase } from "./application/get-last-opened-workspace.js";
import { GetLastOpenedWorkspaceIdUseCase } from "./application/get-last-opened-workspace-id.js";
import { GetWorkspaceUseCase } from "./application/get-workspace.js";
import { ListWorkspacesUseCase } from "./application/list-workspaces.js";
import { OpenWorkspaceUseCase } from "./application/open-workspace.js";
import { RegisterWorkspaceUseCase } from "./application/register-workspace.js";
import { RenameWorkspaceUseCase } from "./application/rename-workspace.js";
import { UnregisterWorkspaceUseCase } from "./application/unregister-workspace.js";
import type { Db } from "./infrastructure/drizzle/workspace-db.js";
import { DrizzleWorkspaceQueries } from "./infrastructure/drizzle/workspace-queries.js";
import { DrizzleWorkspaceRepository } from "./infrastructure/drizzle/workspace-repository.js";
import { LocalWorkspaceProvisioner } from "./infrastructure/file/local-workspace-provisioner.js";

/** Public workspace use-cases. The module owns no resources — the caller
 * assembles the `db` (see {@link openWorkspaceDb}) and owns its lifecycle. */
export interface WorkspaceModule {
  readonly registerWorkspace: RegisterWorkspaceUseCase;
  readonly openWorkspace: OpenWorkspaceUseCase;
  readonly renameWorkspace: RenameWorkspaceUseCase;
  readonly unregisterWorkspace: UnregisterWorkspaceUseCase;
  readonly getWorkspace: GetWorkspaceUseCase;
  readonly listWorkspaces: ListWorkspacesUseCase;
  readonly getLastOpenedWorkspace: GetLastOpenedWorkspaceUseCase;
  readonly getLastOpenedWorkspaceId: GetLastOpenedWorkspaceIdUseCase;
}

export interface WorkspaceModuleOptions {
  /** Assembled DB handle (or a transaction). The module never closes it. */
  readonly db: Db;
  /** Parent directory for auto-created workspace directories. */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

/** Assemble the use-case module over a caller-provided `db`. */
export async function composeWorkspaceModule(
  opts: WorkspaceModuleOptions,
): Promise<WorkspaceModule> {
  if (!path.isAbsolute(opts.defaultWorkspaceParent)) {
    throw new Error(
      `composeWorkspaceModule: defaultWorkspaceParent must be an absolute path; got ${JSON.stringify(
        opts.defaultWorkspaceParent,
      )}`,
    );
  }
  const db = opts.db;
  const repo = new DrizzleWorkspaceRepository({ db });
  const query = new DrizzleWorkspaceQueries({ db });
  const provisioner = new LocalWorkspaceProvisioner();
  const loggerDep = opts.logger ? { logger: opts.logger } : {};

  return {
    registerWorkspace: new RegisterWorkspaceUseCase({
      repo,
      query,
      provisioner,
      defaultWorkspaceParent: opts.defaultWorkspaceParent,
      ...loggerDep,
    }),
    openWorkspace: new OpenWorkspaceUseCase({ repo, ...loggerDep }),
    renameWorkspace: new RenameWorkspaceUseCase({ repo, ...loggerDep }),
    unregisterWorkspace: new UnregisterWorkspaceUseCase({ repo, provisioner, ...loggerDep }),
    getWorkspace: new GetWorkspaceUseCase({ query, ...loggerDep }),
    listWorkspaces: new ListWorkspacesUseCase({ query, ...loggerDep }),
    getLastOpenedWorkspace: new GetLastOpenedWorkspaceUseCase({ query, ...loggerDep }),
    getLastOpenedWorkspaceId: new GetLastOpenedWorkspaceIdUseCase({ query, ...loggerDep }),
  };
}
