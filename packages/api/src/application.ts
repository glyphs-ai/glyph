import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { spawnTerminal } from "@glyphs-ai/terminal";
import {
  composeWorkspaceModule,
  type Workspace,
  type WorkspaceModuleOptions,
  type WorkspaceService,
} from "@glyphs-ai/workspace";
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
 * Beyond per-workspace context resolution, this surface exposes the
 * canonical cross-BC orchestration methods (`registerWorkspace`,
 * `renameWorkspace`, `unregisterWorkspace`, `reloadWorkspace`) so
 * transport layers (HTTP routes, CLI commands) become thin adapters.
 *
 * The per-workspace `WorkspaceContextRegistry` is a private
 * implementation detail — consumers reach contexts via
 * {@link Application.getContext} / {@link Application.loadedContexts}
 * and never touch the registry class directly.
 */
export interface Application {
  readonly workspaceService: WorkspaceService;

  /**
   * Register a workspace. When `workspaceDir` is omitted the application
   * mints a fresh UUID and uses `<defaultWorkspaceParent>/<uuid>` so the
   * workspaceId and the directory basename stay coupled.
   *
   * Returns the canonical {@link Workspace} after register completes
   * (so callers don't have to issue a follow-up read for the
   * server-generated `createdAt`).
   */
  registerWorkspace(opts: {
    readonly name: string;
    readonly workspaceDir?: string;
  }): Promise<Workspace>;

  /**
   * Rename a workspace. Invalidates the per-workspace context so the
   * next request rebuilds with the fresh metadata. Returns the
   * canonical post-rename {@link Workspace}, or `null` if the workspaceId
   * is absent (rare; concurrent unregister).
   */
  renameWorkspace(
    workspaceId: string,
    opts: { readonly newName: string },
  ): Promise<Workspace | null>;

  /**
   * Unregister a workspace. Idempotent (no error if the workspaceId is unknown).
   * Invalidates the per-workspace context afterwards.
   */
  unregisterWorkspace(workspaceId: string, opts?: { readonly purge?: boolean }): Promise<void>;

  /**
   * Force-rebuild the cached per-workspace container. Throws
   * {@link import("./workspace-context.js").WorkspaceHasLiveTasksError}
   * when reload would orphan live task subprocesses; returns `null`
   * when the workspaceId is absent.
   */
  reloadWorkspace(workspaceId: string): Promise<Workspace | null>;

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
  readonly workspace: WorkspaceModuleOptions;
  readonly runtimeRegistry: RuntimeRegistry;
  /**
   * Directory under which `registerWorkspace({ workspaceDir: undefined })`
   * mints `<defaultWorkspaceParent>/<uuid>/`. Required because the
   * default-dir policy is part of the registration contract; without a
   * parent dir the caller MUST supply an explicit `workspaceDir`.
   */
  readonly defaultWorkspaceParent: string;
  readonly logger?: Logger;
}

export async function composeApplication(opts: ApplicationOpts): Promise<Application> {
  if (!path.isAbsolute(opts.defaultWorkspaceParent)) {
    throw new Error(
      `composeApplication: defaultWorkspaceParent must be an absolute path; got ${JSON.stringify(opts.defaultWorkspaceParent)}`,
    );
  }
  const workspaceModule = await composeWorkspaceModule(opts.workspace);
  const registry = new WorkspaceContextRegistry({
    workspaceService: workspaceModule.service,
    runtimeRegistry: opts.runtimeRegistry,
    spawnFn: spawnTerminal,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  const workspaceService = workspaceModule.service;
  const defaultWorkspaceParent = opts.defaultWorkspaceParent;

  return {
    workspaceService,

    async registerWorkspace({ name, workspaceDir }) {
      const workspaceId = randomUUID();
      const resolvedWorkspaceDir =
        workspaceDir === undefined || workspaceDir.trim() === ""
          ? path.join(defaultWorkspaceParent, workspaceId)
          : path.resolve(workspaceDir);
      await workspaceService.register({
        id: workspaceId,
        workspaceDir: resolvedWorkspaceDir,
        name,
      });
      const view = await workspaceService.get(workspaceId);
      if (view === null) {
        // Should be impossible — we just inserted it. Surface as a fault.
        throw new Error(`workspace registered but not readable back: ${workspaceId}`);
      }
      return view;
    },

    async renameWorkspace(workspaceId, { newName }) {
      await workspaceService.rename(workspaceId, { newName });
      await registry.invalidate(workspaceId);
      return workspaceService.get(workspaceId);
    },

    async unregisterWorkspace(workspaceId, opts = {}) {
      await workspaceService.unregister(workspaceId, opts);
      await registry.invalidate(workspaceId);
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
      await workspaceModule.close();
    },
  };
}
