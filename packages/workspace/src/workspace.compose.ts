import path from "node:path";
import type { Logger } from "pino";
import { WorkspaceService } from "./application/workspace.service.js";
import { openDb } from "./persistence/workspace.db.js";
import { WorkspaceRepository } from "./persistence/workspace.repository.js";

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

export interface WorkspaceModule {
  readonly service: WorkspaceService;
  /** Closes the underlying connection. */
  close(): Promise<void>;
}

/**
 * Open the workspace database (WAL + migrations, via `openDb`) and wire
 * up `WorkspaceService`. Tests pass `dbFile: ":memory:"`; production
 * passes the absolute path to `global.db`.
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
  const repo = new WorkspaceRepository({ db });
  const service = new WorkspaceService({
    repo,
    defaultWorkspaceParent: opts.defaultWorkspaceParent,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  return {
    service,
    async close() {
      close();
    },
  };
}
