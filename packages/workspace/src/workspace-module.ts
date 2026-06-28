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
import { openDb } from "./infrastructure/drizzle/db.js";
import { DrizzleWorkspaceRepository } from "./infrastructure/drizzle/workspace-repository.js";
import { LocalWorkspaceProvisioner } from "./infrastructure/file/local-workspace-provisioner.js";

/**
 * Public surface of the workspace package. A `WorkspaceModule` is a
 * dependency-injected container of use-case instances + lifecycle
 * (`close`). The composition root (`composeWorkspaceModule`) opens
 * the DB, instantiates the repository + provisioner adapters, and
 * wires each use-case with the precise deps it needs.
 *
 * Consumers (HTTP routes, CLI commands, MCP handlers) call
 * `module.<useCase>.execute(request)` directly. There is NO `service`
 * facade — every operation has a typed `<XxxRequest>` / `<XxxResponse>`
 * / `<XxxError>` surface published from its own file.
 */
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
  /**
   * Absolute directory under which `register({ workspaceDir: undefined })`
   * mints `<defaultWorkspaceParent>/<uuid>/`. The host owns the root
   * (`$GLYPH_HOME`) and passes a concrete path; the package owns the
   * per-workspace layout beneath it.
   */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

/**
 * Open the workspace database (WAL + migrations, via `openDb`) and
 * assemble the `WorkspaceModule`. Tests pass `dbFile: ":memory:"`;
 * production passes the absolute path to `global.db`.
 */
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
