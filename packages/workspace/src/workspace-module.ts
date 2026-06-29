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
import { openDb } from "./infrastructure/drizzle/workspace-db.js";
import { DrizzleWorkspaceRepository } from "./infrastructure/drizzle/workspace-repository.js";
import { LocalWorkspaceProvisioner } from "./infrastructure/file/local-workspace-provisioner.js";

/** Public workspace use-cases plus module lifecycle. */
export interface WorkspaceModule {
  readonly registerWorkspace: RegisterWorkspaceUseCase;
  readonly openWorkspace: OpenWorkspaceUseCase;
  readonly renameWorkspace: RenameWorkspaceUseCase;
  readonly unregisterWorkspace: UnregisterWorkspaceUseCase;
  readonly getWorkspace: GetWorkspaceUseCase;
  readonly listWorkspaces: ListWorkspacesUseCase;
  readonly getLastOpenedWorkspace: GetLastOpenedWorkspaceUseCase;
  readonly getLastOpenedWorkspaceId: GetLastOpenedWorkspaceIdUseCase;
  /** Closes the underlying SQLite connection. Idempotent. */
  close(): Promise<void>;
}

export interface WorkspaceModuleOptions {
  readonly dbFile: string;
  /** Parent directory for auto-created workspace directories. */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

/** Open the workspace DB and assemble the use-case module. */
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
  const { db, close } = openDb(opts.dbFile);
  const repo = new DrizzleWorkspaceRepository({ db });
  const provisioner = new LocalWorkspaceProvisioner();
  const loggerDep = opts.logger ? { logger: opts.logger } : {};

  return {
    registerWorkspace: new RegisterWorkspaceUseCase({
      repo,
      provisioner,
      defaultWorkspaceParent: opts.defaultWorkspaceParent,
      ...loggerDep,
    }),
    openWorkspace: new OpenWorkspaceUseCase({ repo, ...loggerDep }),
    renameWorkspace: new RenameWorkspaceUseCase({ repo, ...loggerDep }),
    unregisterWorkspace: new UnregisterWorkspaceUseCase({ repo, provisioner, ...loggerDep }),
    getWorkspace: new GetWorkspaceUseCase({ repo, ...loggerDep }),
    listWorkspaces: new ListWorkspacesUseCase({ repo, ...loggerDep }),
    getLastOpenedWorkspace: new GetLastOpenedWorkspaceUseCase({ repo, ...loggerDep }),
    getLastOpenedWorkspaceId: new GetLastOpenedWorkspaceIdUseCase({ repo, ...loggerDep }),
    async close() {
      close();
    },
  };
}
