import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type AgentFqn,
  type CatalogModule,
  composeCatalog,
  type GetSkillResponse,
  type McpFqn,
  type SkillFqn,
} from "@glyphs-ai/catalog";
import type { AgentContentSource, RuntimeRegistry } from "@glyphs-ai/runtime";
import { composeScheduleModule, type ScheduleService } from "@glyphs-ai/schedule";
import {
  type AgentNotFound,
  type AgentResolutionFailed,
  type AgentResolver,
  composeSessionModule,
  type ResolvedAgent,
  type SessionModule,
} from "@glyphs-ai/session";
import {
  composeTaskModule,
  type AgentResolver as TaskAgentResolver,
  type TaskModule,
} from "@glyphs-ai/task";
import type { Spawner } from "@glyphs-ai/terminal";
import { composeWorkflowModule, type WorkflowModule } from "@glyphs-ai/workflow";
import type { GetWorkspaceResponse, WorkspaceId, WorkspaceModule } from "@glyphs-ai/workspace";
import { type Result, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { makeTaskKindHandler } from "./wiring/schedule-task-handler.js";
import { makeWorkflowKindHandler } from "./wiring/schedule-workflow-handler.js";
import { makeCoordNodeRunner } from "./wiring/workflow-coord-task-runner.js";
import { makeHumanNodeRunner } from "./wiring/workflow-human-node-runner.js";
import { makeWorkerNodeRunner } from "./wiring/workflow-worker-task-runner.js";

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Wire DTO for a registered workspace. Same shape `GetWorkspaceResponse`
 * carries when the workspace exists — narrowed to non-null because
 * the context registry only ever holds entries for workspaces that
 * have been resolved successfully.
 */
type Workspace = NonNullable<GetWorkspaceResponse>;
type Skill = NonNullable<GetSkillResponse>;

/**
 * Thrown by `WorkspaceContextRegistry.reload` when the cached context
 * still has live task subprocesses being supervised by its task module.
 * Reload would orphan them.
 */
export class WorkspaceHasLiveTasksError extends Error {
  override readonly name = "WorkspaceHasLiveTasksError";

  constructor(
    public readonly workspaceId: string,
    public readonly liveCount: number,
  ) {
    super(`workspace has ${liveCount} live task(s); reload would orphan them`);
  }
}

/**
 * Thrown by the HTTP middleware when an on-demand `load()` for a
 * cold workspace fails. The original cause is attached via `cause`
 * so request loggers can render the underlying error, but the
 * surface message stays generic so the gated 503 envelope doesn't
 * leak host paths or fs error strings.
 */
export class WorkspaceLoadError extends Error {
  override readonly name = "WorkspaceLoadError";

  constructor(
    public readonly workspaceId: string,
    cause: unknown,
  ) {
    super(`workspace "${workspaceId}" failed to load`);
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Result of a non-loading peek at a workspace's context state.
 *
 *   - `cached`         — context is already resolved and in memory
 *   - `loading`        — a prior `get()` is mid-flight
 *   - `unloaded`       — workspace is registered but never loaded
 *   - `not-registered` — workspace id is unknown to the global DB
 */
export type WorkspaceContextState = "cached" | "loading" | "unloaded" | "not-registered";

/**
 * Per-workspace bundle of long-lived state. Holds the SQLite-backed
 * catalog, session, task, schedule, and workflow services sharing one
 * `workspace.db` via WAL, plus the cross-package orchestration methods
 * for this workspace.
 *
 * "Start an interactive session" semantics live on
 * `sessions.spawnInteractive.execute({ id, remote? })` — callers reach
 * the spawner via `ctx.sessions.spawnInteractive.execute(...)`.
 */
export interface WorkspaceContext {
  readonly workspace: Workspace;
  readonly catalog: CatalogModule;
  readonly sessions: SessionModule;
  readonly tasks: TaskModule;
  /**
   * Per-workspace cron-driven task dispatch substrate. The timer is
   * armed in `load()` via `service.recover()` (catchup-once on boot)
   * and torn down before tasks in `close()` so a fire in flight
   * doesn't race a closed task module.
   */
  readonly schedules: ScheduleService;
  /**
   * Per-workspace DAG-orchestration substrate. Hands the
   * coordinator-kind dispatch path a task-module-backed runner via
   * a two-phase `getModule` thunk (the runner needs a ref to the
   * `WorkflowModule` it sits inside), and the worker-kind
   * dispatch path a sibling runner over the same task module.
   * Closed FIRST in `close()` so the engine's drain step (which
   * calls into `tasks.cancelTask.execute` for any live nodes) still has
   * a live task module to talk to.
   */
  readonly workflows: WorkflowModule;
  /** Closes all backing connections. Idempotent. */
  close(): Promise<void>;
}

interface CatalogAgent {
  readonly dependencies?: { readonly agents?: readonly { readonly fqn: string }[] };
}

interface CatalogBlockedDep {
  readonly fqn: string;
}

interface CatalogBlockedReason {
  readonly needsPrereqsAck?: true;
  readonly disabledByUser?: true;
  readonly orphaned?: true;
  readonly missingDeps?: readonly unknown[];
  readonly blockedDeps?: readonly CatalogBlockedDep[];
}

interface CatalogAgentEntry {
  readonly status: "ready" | "blocked";
  readonly blockedReason?: CatalogBlockedReason;
}

interface CatalogAgentLookup {
  getAgent(fqn: string): Promise<CatalogAgent | null>;
}

interface CatalogRuntimePorts extends AgentContentSource, CatalogAgentLookup {
  getAgentEntry(fqn: string): Promise<CatalogAgentEntry | null>;
}

function makeCatalogRuntimePorts(catalog: CatalogModule): CatalogRuntimePorts {
  const unwrap = async <T, E extends { readonly type: string }>(
    result: PromiseLike<Result<T, E>>,
  ): Promise<T> => {
    const settled = await result;
    if (settled.isErr()) throw new Error(settled.error.type);
    return settled.value;
  };

  const getAgent = async (fqn: string): Promise<CatalogAgent | null> => {
    const res = await catalog.getAgent.execute({ id: fqn as AgentFqn });
    if (res.isErr()) {
      if (res.error.type === "AgentNotFound") return null;
      throw new Error(res.error.type);
    }
    const agents = res.value.dependencies?.agents;
    return agents !== undefined ? { dependencies: { agents } } : {};
  };
  const getSkill = async (fqn: string): Promise<Skill | null> => {
    const res = await catalog.getSkill.execute({ id: fqn as SkillFqn });
    if (res.isErr()) {
      if (res.error.type === "SkillNotFound") return null;
      throw new Error(res.error.type);
    }
    return res.value;
  };

  return {
    getAgent,
    async getAgentEntry(fqn) {
      const entry = await unwrap(catalog.getAgentEntry.execute({ id: fqn as AgentFqn }));
      if (entry === null) return null;
      if (entry.blockedReason === undefined) return { status: entry.status };
      const blockedReason: CatalogBlockedReason = {
        ...(entry.blockedReason.needsPrereqsAck === true ? { needsPrereqsAck: true } : {}),
        ...(entry.blockedReason.disabledByUser === true ? { disabledByUser: true } : {}),
        ...(entry.blockedReason.orphaned === true ? { orphaned: true } : {}),
        ...(entry.blockedReason.missingDeps !== undefined
          ? { missingDeps: entry.blockedReason.missingDeps }
          : {}),
        ...(entry.blockedReason.blockedDeps !== undefined
          ? { blockedDeps: entry.blockedReason.blockedDeps }
          : {}),
      };
      return { status: entry.status, blockedReason };
    },
    resolveAgent(fqn) {
      return unwrap(catalog.resolveAgent.execute({ id: fqn as AgentFqn }));
    },
    async *agentEntries(fqn) {
      const entry = await unwrap(catalog.getAgentEntry.execute({ id: fqn as AgentFqn }));
      if (entry === null) throw new Error("AgentNotFound");
      const files = await unwrap(catalog.listAgentFiles.execute({ id: fqn as AgentFqn }));
      for (const file of files) {
        const content = await unwrap(
          catalog.getAgentFile.execute({ id: fqn as AgentFqn, relPath: file.relPath }),
        );
        if (content !== null) yield { relPath: file.relPath, content };
      }
    },
    async *skillEntries(fqn) {
      const skill = await getSkill(fqn);
      if (skill === null) throw new Error("SkillNotFound");
      const files = await unwrap(catalog.listSkillFiles.execute({ id: fqn as SkillFqn }));
      for (const file of files) {
        const content = await unwrap(
          catalog.getSkillFile.execute({ id: fqn as SkillFqn, relPath: file.relPath }),
        );
        if (content !== null) yield { relPath: file.relPath, content };
      }
    },
    async getMcpRuntimeConfig(fqn) {
      const result = await unwrap(catalog.getMcpContent.execute({ id: fqn as McpFqn }));
      return stripMcpMeta(result.spec, fqn);
    },
  };
}

function stripMcpMeta(content: string, fqn: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MCP file must be a JSON object: ${fqn}`);
  }
  const { _meta: _drop, ...rest } = parsed as Record<string, unknown>;
  return rest;
}

/**
 * Lazy, memoised resolver from URL workspaceId (UUID) to a
 * `WorkspaceContext`. Builds per-workspace SQLite handles + services on
 * first touch, caches them for subsequent requests.
 *
 * This class is the source-of-truth registry of live per-workspace
 * bundles (SQLite handles, task supervisors, SSE event buses). It is
 * NOT an optimisation cache that can be silently dropped — dropping
 * entries without `close()` leaks live resources.
 *
 * Internal to `@glyphs-ai/api`. Consumers go through `Application`
 * methods (`getContext`, `loadedContexts`, `reloadWorkspace`,
 * `unregisterWorkspace`, `close`); the registry is not exported from
 * the package surface.
 */
export class WorkspaceContextRegistry {
  private readonly getWorkspace: WorkspaceModule["getWorkspace"];
  private readonly runtimeRegistry: RuntimeRegistry;
  /** Native Result-based terminal spawner (`@glyphs-ai/terminal`). */
  private readonly spawner: Spawner;
  private readonly logger: Logger;
  private readonly entries = new Map<string, WorkspaceContext>();
  private readonly inflight = new Map<string, Promise<WorkspaceContext | null>>();

  constructor(opts: {
    getWorkspace: WorkspaceModule["getWorkspace"];
    runtimeRegistry: RuntimeRegistry;
    spawner: Spawner;
    logger?: Logger;
  }) {
    this.getWorkspace = opts.getWorkspace;
    this.runtimeRegistry = opts.runtimeRegistry;
    this.spawner = opts.spawner;
    this.logger = opts.logger ?? silentLogger;
  }

  async get(workspaceId: string): Promise<WorkspaceContext | null> {
    const cached = this.entries.get(workspaceId);
    if (cached) return cached;
    const inflight = this.inflight.get(workspaceId);
    if (inflight) return inflight;
    const promise = this.load(workspaceId).finally(() => {
      this.inflight.delete(workspaceId);
    });
    this.inflight.set(workspaceId, promise);
    return promise;
  }

  /**
   * Non-loading classification of a workspace's current context state.
   *
   * Returns synchronously-derived `"cached"` / `"loading"` when the
   * in-memory maps already know about the workspace, otherwise falls
   * back to a global-DB row lookup to distinguish `"unloaded"` (the
   * workspace exists but no per-workspace context has been built
   * yet) from `"not-registered"` (the workspace id is unknown).
   *
   * MUST NOT trigger a `load()` — callers use this to pick between
   * "wait", "warm-up response", "boot a fresh load", and "404 fast"
   * without paying the per-workspace SQLite startup cost.
   */
  async peek(workspaceId: string): Promise<WorkspaceContextState> {
    if (this.entries.has(workspaceId)) return "cached";
    if (this.inflight.has(workspaceId)) return "loading";
    // DatabaseUnavailable from the registry surfaces here as a thrown
    // error — re-throw the underlying driver cause so callers (e.g.
    // middleware, Application.getContext) receive the driver-level
    // failure shape.
    //
    // `workspaceId` is a raw `string` from a URL parameter; the
    // use-case re-parses through `WorkspaceIdSchema` on entry, so
    // the brand cast here is just to thread it through the use-case
    // signature without a redundant pre-parse.
    const result = await this.getWorkspace.execute({ id: workspaceId as WorkspaceId });
    if (result.isErr()) throw result.error.cause;
    return result.value === null ? "not-registered" : "unloaded";
  }

  async invalidate(workspaceId: string): Promise<void> {
    // Drain any in-flight load FIRST. Same race as reload() — without
    // this drain, a concurrent `get(workspaceId)` whose `load()` resolves after
    // we run `entries.delete(workspaceId)` will store the stale context AFTER
    // the invalidate completed, leaking the freshly-built context
    // past the caller's "I just unregistered this" expectation.
    const inflight = this.inflight.get(workspaceId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        // best-effort — the load that produced the throw is the
        // caller's problem, not ours.
      }
    }
    const cached = this.entries.get(workspaceId);
    if (cached) {
      try {
        await cached.close();
      } catch {
        // best-effort
      }
      this.logger.info({ workspaceId }, "per-workspace container invalidated");
    }
    this.entries.delete(workspaceId);
  }

  async reload(workspaceId: string): Promise<WorkspaceContext | null> {
    // First, drain any in-flight `get()` for this workspaceId. Without this,
    // a concurrent caller of get() could finish loading AFTER our
    // `entries.delete(workspaceId)` line and re-populate the cache with a
    // stale entry that immediately leaks (our subsequent get() would
    // mint a different one).
    const inflight = this.inflight.get(workspaceId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        // best-effort — propagate via the eventual get() below
      }
    }
    const cached = this.entries.get(workspaceId);
    if (cached) {
      const live = cached.tasks.liveCount();
      if (live > 0) {
        this.logger.warn(
          { workspaceId, liveCount: live },
          "workspace reload refused: live tasks would be orphaned",
        );
        throw new WorkspaceHasLiveTasksError(workspaceId, live);
      }
      try {
        await cached.close();
      } catch {
        // best-effort
      }
    }
    this.entries.delete(workspaceId);
    const fresh = await this.get(workspaceId);
    if (fresh !== null) {
      this.logger.info({ workspaceId }, "per-workspace container reloaded");
    }
    return fresh;
  }

  loaded(): WorkspaceContext[] {
    return [...this.entries.values()];
  }

  async closeAll(): Promise<void> {
    // Drain in-flight loads first. Without this, a concurrent
    // `get(workspaceId)` whose promise resolves AFTER our iteration over
    // `entries` would re-populate the map post-close and leak the
    // newly-built context past process exit. Same drain-then-act
    // pattern used by `reload(workspaceId)`.
    const inflight = [...this.inflight.values()];
    for (const p of inflight) {
      try {
        await p;
      } catch {
        // best-effort
      }
    }
    for (const ctx of this.entries.values()) {
      try {
        await ctx.close();
      } catch {
        // best-effort
      }
    }
    this.entries.clear();
  }

  private async load(workspaceId: string): Promise<WorkspaceContext | null> {
    const result = await this.getWorkspace.execute({ id: workspaceId as WorkspaceId });
    if (result.isErr()) {
      // Re-throw the driver cause so `Application.getContext` wraps
      // it as `WorkspaceLoadError(workspaceId, cause)` and every host
      // sees a stable `WorkspaceLoadError(workspaceId, cause)` shape.
      throw result.error.cause;
    }
    const workspace = result.value;
    if (!workspace) return null;

    const dbFile = path.join(workspace.workspaceDir, "workspace.db");
    await mkdir(workspace.workspaceDir, { recursive: true });

    // Partial-failure safety: each successive composeXxxModule opens
    // its own SQLite handle. If a later one throws, the earlier
    // handles would leak (file lock held, WAL file pinned, …) unless
    // we tear them down on the failure path. Track each handle as we
    // build, and on any throw run them in reverse order so the
    // entire load is "all-or-nothing" from a resource POV.
    const cleanup: Array<() => Promise<void>> = [];
    const teardown = async (): Promise<void> => {
      while (cleanup.length > 0) {
        const fn = cleanup.pop();
        if (!fn) break;
        try {
          await fn();
        } catch {
          // best-effort — primary error has already been thrown
        }
      }
    };

    let catalogModule: CatalogModule;
    let sessionModule: Awaited<ReturnType<typeof composeSessionModule>>;
    let taskModule: Awaited<ReturnType<typeof composeTaskModule>>;
    let scheduleModule: Awaited<ReturnType<typeof composeScheduleModule>>;
    let workflowModule: Awaited<ReturnType<typeof composeWorkflowModule>>;
    // Two-phase init seam: the coord runner needs a ref to the
    // `WorkflowModule` it lives inside (to read header `brief` /
    // `details` at dispatch time), but the service is constructed
    // by `composeWorkflowModule` which itself requires the runner.
    // The thunk lets us build the runner first, call compose, then
    // assign the ref. Mirrors the engine ↔ service two-phase init
    // in `@glyphs-ai/workflow`.
    let workflowRef: WorkflowModule | null = null;
    const getWorkflowModule = (): WorkflowModule => {
      if (workflowRef === null) {
        throw new Error(
          "workspace-context: workflow module accessed before composeWorkflowModule completed",
        );
      }
      return workflowRef;
    };
    try {
      catalogModule = composeCatalog({ dbFile });
      cleanup.push(() => catalogModule.close());
      const catalogPorts = makeCatalogRuntimePorts(catalogModule);
      const agentResolver: AgentResolver = {
        resolve: (agent) =>
          catalogModule.resolveAgent
            .execute({ id: agent as AgentFqn })
            .map((resolved): ResolvedAgent => resolved)
            .mapErr((e): AgentNotFound | AgentResolutionFailed =>
              e.type === "AgentNotFound"
                ? { type: "AgentNotFound", agent }
                : { type: "AgentResolutionFailed", agent, cause: e },
            ),
      };
      // task's AgentResolver port needs `resolve` (shared with the
      // session resolver above) + `getEntry` (dispatch-time readiness).
      // `catalogPorts.getAgentEntry` already returns task's AgentEntry
      // shape; wrap its promise on the Result rail and surface any throw
      // as `AgentResolutionFailed`.
      const taskAgentResolver: TaskAgentResolver = {
        resolve: agentResolver.resolve,
        getEntry: (agent) =>
          ResultAsync.fromPromise(catalogPorts.getAgentEntry(agent), (cause) => ({
            type: "AgentResolutionFailed" as const,
            agent,
            cause,
          })),
      };
      sessionModule = await composeSessionModule({
        dbFile,
        agentResolver,
        contentSource: catalogPorts,
        runtimeRegistry: this.runtimeRegistry,
        workspaceDir: workspace.workspaceDir,
        workspaceId,
        spawner: this.spawner,
      });
      cleanup.push(() => sessionModule.close());
      taskModule = await composeTaskModule({
        dbFile,
        agentResolver: taskAgentResolver,
        contentSource: catalogPorts,
        runtimeRegistry: this.runtimeRegistry,
        workspaceDir: workspace.workspaceDir,
        workspaceId,
        logger: this.logger,
      });
      cleanup.push(() => taskModule.close());

      // Schedules are composed AFTER tasks so the kind handler's
      // `dispatchTask` / `hasInFlightByOrigin` / `deleteTerminalByOrigin`
      // use-cases have a live task module. The same workspace.db
      // file is reused (WAL-mode shared connection); migrations are
      // idempotent.
      scheduleModule = await composeScheduleModule({
        dbFile,
        logger: this.logger,
      });
      cleanup.push(() => scheduleModule.close());

      const recoverTasks = await taskModule.recoverOrphanedTasks.execute({});
      if (recoverTasks.isErr()) throw new Error(recoverTasks.error.type);
      // Register every kind BEFORE recover(). recover() freezes the
      // registry and preflights every persisted row's target_kind
      // against it — any row with an unregistered kind throws
      // ScheduleKindNotRegisteredError naming the kind + the
      // register-before-recover requirement. The order is also
      // load-bearing for the catchup path: a catchup fire (next
      // fire in the past at boot) needs the freshly-reconciled
      // task list when it checks hasInFlightByOrigin.
      scheduleModule.service.registerKind(
        "task",
        makeTaskKindHandler({
          tasks: taskModule,
          catalog: catalogPorts,
        }),
      );

      // Workflow substrate composed BEFORE recover() so the workflow
      // kind handler is registered and recover()'s catchup path can
      // dispatch workflow-kind schedules whose next fire is in the
      // past at boot. Build runners first — `composeWorkflowModule`
      // requires them in its opts object — and capture the workflow
      // service ref via the `getWorkflowService` thunk for the coord
      // runner.
      const coordRunner = makeCoordNodeRunner({
        tasks: taskModule,
        catalog: catalogPorts,
        getModule: getWorkflowModule,
        // The coord runner injects `GLYPH_WORKFLOW_DIR` into the
        // dispatched coord task's subprocess env via
        // `workflowDir(workspaceDir, wfid)`. The workspaceDir is the
        // same root the workflow substrate uses when materialising
        // the dir on `createWorkflow`, so the path the runner
        // injects matches what the substrate already created.
        workspaceDir: workspace.workspaceDir,
        logger: this.logger,
      });
      const workerRunner = makeWorkerNodeRunner({
        tasks: taskModule,
        catalog: catalogPorts,
        logger: this.logger,
      });
      const humanRunner = makeHumanNodeRunner({
        getModule: getWorkflowModule,
      });
      workflowModule = await composeWorkflowModule({
        dbFile,
        workspaceDir: workspace.workspaceDir,
        logger: this.logger,
        runners: { coordinator: coordRunner, worker: workerRunner, human: humanRunner },
      });
      workflowRef = workflowModule;
      cleanup.push(() => workflowModule.close());

      // Register workflow kind AFTER compose so the handler can
      // reference the live WorkflowModule for dispatch / hasInFlight
      // / deleteTerminalByOrigin. Both kinds are now registered; recover()
      // below will preflight all persisted rows and fire catchups.
      scheduleModule.service.registerKind(
        "workflow",
        makeWorkflowKindHandler({
          workflows: workflowModule,
          tasks: taskModule,
          catalog: catalogPorts,
        }),
      );
      await scheduleModule.service.recover();
    } catch (err) {
      await teardown();
      throw err;
    }

    const outerLogger = this.logger;
    const context: WorkspaceContext = {
      workspace,
      catalog: catalogModule,
      sessions: sessionModule,
      tasks: taskModule,
      schedules: scheduleModule.service,
      workflows: workflowModule,
      async close() {
        // Per-module try/catch: a throw from one module's close()
        // must NOT skip the others. Without per-module catches a
        // `taskModule.close()` throw would leak the session +
        // catalog SQLite handles. Same all-or-nothing disposal
        // idiom as load()'s cleanup stack.
        //
        // Ordering: workflow FIRST, then schedule, then task /
        // session / catalog (reverse of compose). workflow's
        // close() awaits `engine.drain()` which awaits in-flight
        // ticks; those ticks dispatch through the task module, so
        // tasks must still be alive while workflow drains.
        // schedule's close() likewise awaits `service.shutdown()`
        // which clears the in-flight setTimeout queue; closing it
        // before tasks means no new fires can land on a closed task
        // module.
        //
        // Multi-error handling: the FIRST error is re-thrown so the
        // caller sees something; LATER errors are logged via the
        // pkg's `silentLogger`-or-injected logger so a wedged 2nd
        // module isn't lost.
        const errors: unknown[] = [];
        try {
          await workflowModule.close();
        } catch (err) {
          errors.push(err);
        }
        try {
          await scheduleModule.close();
        } catch (err) {
          errors.push(err);
        }
        try {
          await taskModule.close();
        } catch (err) {
          errors.push(err);
        }
        try {
          await sessionModule.close();
        } catch (err) {
          errors.push(err);
        }
        try {
          await catalogModule.close();
        } catch (err) {
          errors.push(err);
        }
        if (errors.length > 0) {
          for (const e of errors.slice(1)) {
            outerLogger.error(
              { workspaceId, err: e instanceof Error ? e.message : String(e) },
              "per-workspace container close: secondary module failed during disposal",
            );
          }
          throw errors[0];
        }
      },
    };
    this.entries.set(workspaceId, context);
    this.logger.info(
      { workspaceId, workspaceDir: workspace.workspaceDir, dbFile },
      "per-workspace container built (first request)",
    );
    return context;
  }
}
