import { randomBytes as cryptoRandomBytes } from "node:crypto";
import type { AgentContentSource, RuntimeRegistry } from "@glyphs-ai/runtime";
import pino, { type Logger } from "pino";
import { AggregateByOriginUseCase } from "./application/aggregate-by-origin.js";
import { CancelTaskUseCase } from "./application/cancel-task.js";
import { DeleteTaskUseCase } from "./application/delete-task.js";
import { DeleteTerminalByOriginUseCase } from "./application/delete-terminal-by-origin.js";
import { DispatchTaskUseCase } from "./application/dispatch-task.js";
import { FindLatestByOriginUseCase } from "./application/find-latest-by-origin.js";
import { GetTaskUseCase } from "./application/get-task.js";
import { GetTaskActivityUseCase } from "./application/get-task-activity.js";
import { GetTaskActivityStreamUseCase } from "./application/get-task-activity-stream.js";
import { HasInFlightByOriginUseCase } from "./application/has-in-flight-by-origin.js";
import { ListArtifactsUseCase } from "./application/list-artifacts.js";
import { ListInFlightByOriginUseCase } from "./application/list-in-flight-by-origin.js";
import { ListTasksUseCase } from "./application/list-tasks.js";
import type { AgentResolver } from "./application/ports/agent-resolver.js";
import { RecoverOrphanedTasksUseCase } from "./application/recover-orphaned-tasks.js";
import { ResolveArtifactPathUseCase } from "./application/resolve-artifact-path.js";
import { InMemoryLiveProcessRegistry } from "./application/supervision/in-memory-live-process-registry.js";
import { TaskSupervisor } from "./application/supervision/task-supervisor.js";
import type { Db } from "./infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "./infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "./infrastructure/drizzle/task-repository.js";
import { LocalTaskSandbox, tasksRoot } from "./infrastructure/file/local-task-sandbox.js";

/**
 * Public surface of `@glyphs-ai/task`: a DI container of use-case
 * instances plus the lifecycle hooks (`liveCount` / `shutdown` / `close`).
 * Consumers call `module.<useCase>.execute(...)`; there is no service facade.
 */
export interface TaskModule {
  readonly dispatchTask: DispatchTaskUseCase;
  readonly cancelTask: CancelTaskUseCase;
  readonly deleteTask: DeleteTaskUseCase;
  readonly getTask: GetTaskUseCase;
  readonly listTasks: ListTasksUseCase;
  readonly listArtifacts: ListArtifactsUseCase;
  readonly getTaskActivity: GetTaskActivityUseCase;
  readonly getTaskActivityStream: GetTaskActivityStreamUseCase;
  readonly recoverOrphanedTasks: RecoverOrphanedTasksUseCase;
  readonly resolveArtifactPath: ResolveArtifactPathUseCase;
  readonly hasInFlightByOrigin: HasInFlightByOriginUseCase;
  readonly listInFlightByOrigin: ListInFlightByOriginUseCase;
  readonly findLatestByOrigin: FindLatestByOriginUseCase;
  readonly deleteTerminalByOrigin: DeleteTerminalByOriginUseCase;
  readonly aggregateByOrigin: AggregateByOriginUseCase;
  /** Tasks the manager is currently supervising (live subprocesses + in-flight dispatches). */
  liveCount(): number;
  /** Kill live subprocesses, drain exit watchers, and stop accepting new dispatches. */
  shutdown(): Promise<void>;
  /** No-op on the DB — the host owns the connection. Does NOT stop subprocesses; call `shutdown` first. */
  close(): Promise<void>;
}

export type TaskModuleOptions = {
  readonly db: Db;
  /** Resolves catalog agents (adapter over `@glyphs-ai/catalog`, wired by the host). */
  readonly agentResolver: AgentResolver;
  /** Supplies agent/skill/mcp bytes to `runtime.launchHeadless` (catalog satisfies it). */
  readonly contentSource: AgentContentSource;
  /** Result-based runtime registry; must contain at least the default runtime. */
  readonly runtimeRegistry: RuntimeRegistry;
  readonly workspaceDir: string;
  readonly workspaceId: string;
  /** Optional logger. Defaults to silent. */
  readonly logger?: Logger;
  /** Test seam: clock for id generation + timestamps. */
  readonly now?: () => Date;
  /** Test seam: random byte source for id generation. */
  readonly randomBytes?: (n: number) => Buffer;
};

/**
 * Assemble the module around a caller-provided drizzle handle over the
 * per-workspace `workspace.db`. The host owns the connection; package tests
 * build one via `openTestDb` in `test/testing.ts`. The `TaskSupervisor`
 * is the single stateful dependency shared by the dispatch / cancel / delete
 * use-cases.
 */
export async function composeTaskModule(opts: TaskModuleOptions): Promise<TaskModule> {
  const { db } = opts;
  const logger = opts.logger ?? pino({ level: "silent" });
  const now = opts.now ?? (() => new Date());
  const randomBytes = opts.randomBytes ?? cryptoRandomBytes;

  const repository = new DrizzleTaskRepository({ db, logger });
  const query = new DrizzleTaskQueries({ db });
  const sandbox = new LocalTaskSandbox({ root: tasksRoot(opts.workspaceDir) });
  const liveProcesses = new InMemoryLiveProcessRegistry();
  const supervisor = new TaskSupervisor({
    repository,
    runtimeRegistry: opts.runtimeRegistry,
    sandbox,
    liveProcesses,
    contentSource: opts.contentSource,
    workspaceId: opts.workspaceId,
    workspaceDir: opts.workspaceDir,
    now,
    logger,
  });

  return {
    dispatchTask: new DispatchTaskUseCase({
      supervisor,
      agentResolver: opts.agentResolver,
      runtimeRegistry: opts.runtimeRegistry,
      now,
      randomBytes,
    }),
    cancelTask: new CancelTaskUseCase({ supervisor }),
    deleteTask: new DeleteTaskUseCase({ repository, supervisor }),
    getTask: new GetTaskUseCase({ query, runtimeRegistry: opts.runtimeRegistry }),
    listTasks: new ListTasksUseCase({ query }),
    listArtifacts: new ListArtifactsUseCase({ query, sandbox }),
    getTaskActivity: new GetTaskActivityUseCase({
      query,
      runtimeRegistry: opts.runtimeRegistry,
    }),
    getTaskActivityStream: new GetTaskActivityStreamUseCase({
      query,
      runtimeRegistry: opts.runtimeRegistry,
    }),
    recoverOrphanedTasks: new RecoverOrphanedTasksUseCase({ repository, query, now, logger }),
    resolveArtifactPath: new ResolveArtifactPathUseCase({ query, sandbox }),
    hasInFlightByOrigin: new HasInFlightByOriginUseCase({ query }),
    listInFlightByOrigin: new ListInFlightByOriginUseCase({ query }),
    findLatestByOrigin: new FindLatestByOriginUseCase({ query }),
    deleteTerminalByOrigin: new DeleteTerminalByOriginUseCase({
      repository,
      supervisor,
      logger,
    }),
    aggregateByOrigin: new AggregateByOriginUseCase({ query }),
    liveCount() {
      return supervisor.liveCount();
    },
    shutdown() {
      return supervisor.shutdown();
    },
    async close() {
      // The host owns the shared connection; the module holds no handle to close.
    },
  };
}
