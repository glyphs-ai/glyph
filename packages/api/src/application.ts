import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { localSpawner } from "@glyphs-ai/terminal";
import {
  composeWorkspaceModule,
  type DatabaseUnavailable,
  type GetWorkspaceResponse,
  openWorkspaceDb,
  type WorkspaceId,
  type WorkspaceModule,
  type WorkspaceName,
  type WorkspaceNotFound,
} from "@glyphs-ai/workspace";
import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import {
  type WorkspaceContext,
  WorkspaceContextRegistry,
  type WorkspaceContextState,
  WorkspaceLoadError,
} from "./workspace-context.js";

/**
 * Composition root for the global registry plus on-demand
 * per-workspace contexts. The server calls `composeApplication({...})`
 * once and routes every per-workspace request through the returned
 * `Application`; other in-process hosts can do the same without
 * exposing this layer to UI surfaces.
 *
 * The `workspace` module bundles the eight workspace use-cases as
 * dependency-injected `<UseCase>.execute(request)` instances;
 * transports (HTTP routes, CLI, MCP) call them directly. The methods
 * mounted on `Application` itself are the small cross-cutting subset
 * that also has to invalidate the per-workspace context cache
 * (`renameWorkspace`, `unregisterWorkspace`, `reloadWorkspace`).
 *
 * The per-workspace `WorkspaceContextRegistry` is a private
 * implementation detail — consumers reach contexts via
 * {@link Application.getContext} / {@link Application.loadedContexts}
 * and never touch the registry class directly.
 */
export interface Application {
  readonly workspace: WorkspaceModule;

  /**
   * Rename a workspace. Invalidates the per-workspace context so the
   * next request rebuilds with the fresh metadata. Returns
   * `Result.Ok<Workspace | null>` (`null` when the workspaceId is
   * absent — rare; concurrent unregister) or `Err` over the workspace
   * domain errors.
   */
  renameWorkspace(
    workspaceId: string,
    input: { readonly name: WorkspaceName },
  ): ResultAsync<GetWorkspaceResponse, WorkspaceNotFound | DatabaseUnavailable>;

  /**
   * Unregister a workspace. Idempotent (no error if the workspaceId is
   * unknown). Invalidates the per-workspace context afterwards.
   */
  unregisterWorkspace(workspaceId: string): ResultAsync<void, DatabaseUnavailable>;

  /**
   * Force-rebuild the cached per-workspace container. Throws
   * {@link import("./workspace-context.js").WorkspaceHasLiveTasksError}
   * when reload would orphan live task subprocesses; returns `null`
   * when the workspaceId is absent.
   */
  reloadWorkspace(workspaceId: string): Promise<GetWorkspaceResponse>;

  /**
   * Resolve the per-workspace {@link WorkspaceContext}, building it on
   * first request. Returns `null` when the workspaceId is not registered.
   */
  getContext(workspaceId: string): Promise<WorkspaceContext | null>;

  /**
   * Non-loading peek at a workspace's context state. MUST NOT trigger
   * a `load()` — used by the HTTP middleware to pick between waiting,
   * a warming-up response, kicking off a fresh load, or 404 without
   * paying the per-workspace SQLite startup cost.
   *
   * See {@link WorkspaceContextState} for the four values.
   */
  peekContextState(workspaceId: string): Promise<WorkspaceContextState>;

  /**
   * Snapshot of every {@link WorkspaceContext} currently held in the
   * internal registry. Used during graceful shutdown to drain live
   * task subprocesses before tearing down the SQLite handles.
   */
  loadedContexts(): WorkspaceContext[];

  /** Closes the global registry connection and every per-workspace context. Idempotent. */
  close(): Promise<void>;
}

/** Typed opts object for `composeApplication`. */
export interface ApplicationOpts {
  readonly workspace: {
    /** libsql URL for the global registry DB (a `file:` URL in production,
     * `":memory:"` in tests). The caller owns file-path policy. */
    readonly dbUrl: string;
    /** Parent directory for auto-created workspace directories. */
    readonly defaultWorkspaceParent: string;
    readonly logger?: Logger;
  };
  readonly runtimeRegistry: RuntimeRegistry;
  readonly logger?: Logger;
}

export async function composeApplication(opts: ApplicationOpts): Promise<Application> {
  // The api layer is the assembler: it opens the global registry DB from the
  // caller-provided url, then hands the bare handle to the workspace module
  // (which owns schema + use-cases, never file-path policy). This composer
  // owns the handle's lifecycle via `close()`.
  const { db, close: closeWorkspaceDb } = await openWorkspaceDb({ url: opts.workspace.dbUrl });
  let workspace: WorkspaceModule;
  try {
    workspace = await composeWorkspaceModule({
      db,
      defaultWorkspaceParent: opts.workspace.defaultWorkspaceParent,
      ...(opts.workspace.logger !== undefined ? { logger: opts.workspace.logger } : {}),
    });
  } catch (err) {
    closeWorkspaceDb();
    throw err;
  }
  const registry = new WorkspaceContextRegistry({
    getWorkspace: workspace.getWorkspace,
    runtimeRegistry: opts.runtimeRegistry,
    spawner: localSpawner,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });

  return {
    workspace,

    renameWorkspace(workspaceId, input) {
      // `workspaceId` is a raw `string` from the URL/CLI; the
      // use-case re-parses through `WorkspaceIdSchema` on entry, so
      // the brand cast is just to thread it through the typed
      // signature. Same applies below.
      const id = workspaceId as WorkspaceId;
      return workspace.renameWorkspace
        .execute({ id, name: input.name })
        .andThen(() =>
          ResultAsync.fromSafePromise(registry.invalidate(workspaceId)).andThen(() =>
            workspace.getWorkspace.execute({ id }),
          ),
        );
    },

    unregisterWorkspace(workspaceId) {
      const id = workspaceId as WorkspaceId;
      return workspace.unregisterWorkspace
        .execute({ id })
        .andThen(() => ResultAsync.fromSafePromise(registry.invalidate(workspaceId)));
    },

    async reloadWorkspace(workspaceId) {
      const ctx = await registry.reload(workspaceId);
      return ctx === null ? null : ctx.workspace;
    },

    async getContext(workspaceId) {
      try {
        return await registry.get(workspaceId);
      } catch (err) {
        // Own the cold-load failure at the facade so every host (HTTP,
        // CLI, in-process) sees the same typed `WorkspaceLoadError`
        // rather than a raw fs / compose throw. The original cause is
        // attached for logging. `registry.get` surfaces raw causes, so
        // the instanceof guard is idempotency insurance against an
        // already-wrapped throw.
        throw err instanceof WorkspaceLoadError ? err : new WorkspaceLoadError(workspaceId, err);
      }
    },

    peekContextState(workspaceId) {
      return registry.peek(workspaceId);
    },

    loadedContexts() {
      return registry.loaded();
    },

    async close() {
      // Close the per-workspace registry first so any open per-workspace
      // SQLite handles / file watchers / SDK clients release before we
      // tear down the global registry. Documented as a caller
      // requirement on Application.close, but enforcing it here makes
      // the surface harder to misuse and matches Stripe-style
      // resource ownership (the composer composes -> the composer
      // disposes, top-down).
      await registry.closeAll();
      closeWorkspaceDb();
    },
  };
}
