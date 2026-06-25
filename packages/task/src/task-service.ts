/**
 * @glyphs-ai/task — `TaskService` facade.
 *
 * Thin orchestrator class. Each public method delegates to one of
 * five concern-specific modules under `./task-service/`:
 *   - `queries.ts`         — read-side (list, get, hasInFlight,
 *                             liveCount, resolveArtifactPath)
 *   - `activity-stream.ts` — runtime activity surface
 *   - `agent-resolver.ts`  — catalog/runtime resolution + spawn
 *                             internals shared by dispatch
 *   - `mutations.ts`       — write-side (dispatch, cancel, delete,
 *                             deleteTerminalByOriginMetadata, recoverOrphaned)
 *   - `shutdown.ts`        — lifecycle hooks
 *
 * Shared state lives in a single `TaskServiceCtx` object built in
 * the constructor and passed to every internal function. The
 * `task-service/` subdir is implementation detail — not re-exported
 * from `./index.ts`.
 */

import { randomBytes as cryptoRandomBytes } from "node:crypto";
import path from "node:path";
import type { AgentContentSource, RuntimeRegistry } from "@glyphs-ai/runtime";
import pino, { type Logger } from "pino";
import { tasksRoot } from "./paths.js";
import type { AgentResolverPort } from "./ports.js";
import type { TaskEntity } from "./task-entity.js";
import { TaskRepository } from "./task-repository.js";
import type { LiveTask } from "./task-service/_helpers.js";
import { getTaskActivity, getTaskActivityStream } from "./task-service/activity-stream.js";
import {
  cancelTask,
  deleteTask,
  deleteTerminalByOriginMetadata,
  dispatchTask,
  recoverOrphaned,
} from "./task-service/mutations.js";
import {
  findTaskByWorkflowNode,
  getTask,
  hasInFlightForWorkflowNode,
  listInFlightForWorkflowNode,
  listTasks,
  liveCount,
  resolveArtifactPath,
} from "./task-service/queries.js";
import { drainPendingPurges, shutdownService } from "./task-service/shutdown.js";
import type { DispatchOpts, ListTaskOpts, Task, TaskServiceOpts } from "./types.js";

const silentLogger = pino({ level: "silent" });

/** Default runtime kind used when a dispatch omits `opts.runtime`. */
export const DEFAULT_RUNTIME = "copilot";

/**
 * Shared state passed by the facade to every internal function. Field
 * names mirror {@link TaskServiceOpts} for injected ports and test
 * seams; the public `db` handle is wrapped as `repository`, and
 * `tasksDir` is derived from `workspaceDir`.
 *
 * `readonly` markers reflect identity-stability (the `Map`,
 * repository handle, logger etc. are never reassigned), NOT
 * deep-immutability — `live.set`, `dispatchInProgress.add`, and
 * mutation of `shuttingDown` / `purgeQueue` are how internals
 * coordinate cross-concern state.
 *
 * Exported for the internal `./task-service/*` files to import as
 * `import type`. NOT re-exported from `./index.ts`.
 */
export interface TaskServiceCtx {
  readonly repository: TaskRepository;
  readonly agentResolver: AgentResolverPort;
  readonly contentSource: AgentContentSource;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly workspaceDir: string;
  readonly workspaceId: string;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly randomBytes: (n: number) => Buffer;
  readonly tasksDir: string;
  /** id → live record for tasks whose subprocess this manager still owns. */
  readonly live: Map<string, LiveTask>;
  /**
   * Ids whose `dispatch()` call is between workdir reservation and
   * the `live.set` at the end of dispatch. Surfaced via `liveCount`
   * so the workspace reload guard sees in-flight dispatches as
   * "live" and refuses to evict the cached manager.
   */
  readonly dispatchInProgress: Set<string>;
  /** True once `shutdown()` has been called; gates exit-watcher's status decision. */
  shuttingDown: boolean;
  /**
   * Serialised chain of background purges enqueued by
   * `enqueueBackgroundPurge`. Tests await its tail via
   * `_drainPendingPurgesForTest`. A single chained promise (rather
   * than a parallel `Set<Promise>`) is used because fs.rm of a
   * copilot state dir on Windows pins a libuv worker for tens of
   * seconds; serialising prevents the worker pool from being
   * saturated.
   */
  purgeQueue: Promise<void>;
}

/**
 * Per-workspace registry of autonomous tasks.
 *
 * Owns `<tasksDir>/` on disk. Each task is one directory; queryable
 * metadata (status, runtime, agent, timings, the open-shape
 * `metadata` bag) lives in the per-workspace `workspace.db` `tasks`
 * table — one row per task, owned by `TaskRepository`. The runtime
 * keeps its own per-task event log on its own state directory
 * (Copilot: `<copilotStateDir>/<runtimeSessionId>/events.jsonl`).
 *
 * Responsibilities: reserve fresh id+workdir per dispatch; hand the
 * spawn off to the runtime; watch for exit and persist terminal
 * status; on shutdown kill+drain live subprocesses; on bootstrap
 * mark orphaned `running` tasks as failure. The `TaskEntity` value
 * type IS the FSM; this class orchestrates persistence + side
 * effects around it.
 */
export class TaskService {
  private readonly ctx: TaskServiceCtx;

  constructor(opts: TaskServiceOpts) {
    const workspaceDir = path.resolve(opts.workspaceDir);
    const logger = opts.logger ?? silentLogger;
    this.ctx = {
      repository: new TaskRepository({ db: opts.db, logger }),
      agentResolver: opts.agentResolver,
      contentSource: opts.contentSource,
      runtimeRegistry: opts.runtimeRegistry,
      workspaceDir,
      tasksDir: tasksRoot(workspaceDir),
      workspaceId: opts.workspaceId,
      logger,
      now: opts.now ?? (() => new Date()),
      randomBytes: opts.randomBytes ?? defaultRandomBytes,
      live: new Map(),
      dispatchInProgress: new Set(),
      shuttingDown: false,
      purgeQueue: Promise.resolve(),
    };
  }

  /**
   * @internal Test seam for `cancel()`'s during-dispatch race
   * (`task-service.cancel-during-dispatch-window.test.ts`) which
   * casts the instance to `{ dispatchInProgress: Set<string> }` to
   * pre-populate an id before exercising cancel. Returns the same
   * `Set` the ctx owns.
   */
  private get dispatchInProgress(): Set<string> {
    return this.ctx.dispatchInProgress;
  }

  async dispatch(opts: DispatchOpts): Promise<Task> {
    return toTask(await dispatchTask(this.ctx, opts));
  }

  async list(opts: ListTaskOpts = {}): Promise<Task[]> {
    return (await listTasks(this.ctx, opts)).map(toTask);
  }

  async hasInFlightByOriginMetadata(opts: {
    readonly origin: string;
    readonly metadataKey: string;
    readonly metadataValue: string;
  }): Promise<boolean> {
    return this.ctx.repository.hasInFlightByOriginMetadata(opts);
  }

  /**
   * True if any non-terminal task originated from the workflow with
   * `metadata.workflowNodeId === nodeId`. Narrow surface used by
   * `@glyphs-ai/api/src/wiring/workflow-worker-task-runner.ts` to implement
   * `WorkflowNodeRunner.hasInFlightForNode` for worker nodes without
   * broadening {@link ListTaskOpts} with a generic metadata filter.
   *
   * The metadata key `workflowNodeId` matches the canonical reverse-
   * lookup contract in `packages/workflow/src/types.ts:222`.
   */
  async hasInFlightForWorkflowNode(nodeId: string): Promise<boolean> {
    return hasInFlightForWorkflowNode(this.ctx, nodeId);
  }

  /**
   * List non-terminal tasks for a given workflow node. Companion to
   * {@link TaskService.hasInFlightForWorkflowNode}; used by the
   * worker runner's `cancel(nodeId)` reverse-lookup so it can call
   * `tasks.cancel(...)` on each in-flight task. Best-effort, may be
   * empty.
   */
  async listInFlightForWorkflowNode(nodeId: string): Promise<Task[]> {
    return (await listInFlightForWorkflowNode(this.ctx, nodeId)).map(toTask);
  }

  /**
   * Find the most recent task (terminal or not) dispatched for a
   * workflow node. Powers the wire-shape projector's
   * `WorkflowNode.taskId` enrichment so the dashboard can
   * navigate from a node click to its dispatched task. Returns
   * `null` when no task exists for the node (the worker has not
   * dispatched yet).
   */
  async findTaskByWorkflowNode(nodeId: string): Promise<Task | null> {
    const task = await findTaskByWorkflowNode(this.ctx, nodeId);
    return task === null ? null : toTask(task);
  }

  async deleteTerminalByOriginMetadata(opts: {
    readonly origin: string;
    readonly metadataKey: string;
    readonly metadataValue: string;
  }): Promise<{ deletedCount: number }> {
    return deleteTerminalByOriginMetadata(this.ctx, opts);
  }

  async aggregateByOriginMetadataKey(opts: {
    readonly origin: string;
    readonly metadataKey: string;
    readonly metadataValues: readonly string[];
    readonly statusIn?: readonly string[];
  }): Promise<ReadonlyMap<string, { readonly totalCount: number; readonly runningCount: number }>> {
    return this.ctx.repository.aggregateByOriginMetadataKey(opts);
  }

  async get(id: string): Promise<Task | null> {
    const task = await getTask(this.ctx, id);
    return task === null ? null : toTask(task);
  }

  async getTaskActivity(
    id: string,
    opts?: { readonly before?: number; readonly after?: number; readonly limit?: number },
  ): Promise<import("@glyphs-ai/runtime").ActivityResult | null> {
    return getTaskActivity(this.ctx, id, opts);
  }

  async getTaskActivityStream(
    id: string,
    opts: { readonly after?: number; readonly signal?: AbortSignal },
  ): Promise<AsyncIterable<import("@glyphs-ai/runtime").ActivityItem> | null> {
    return getTaskActivityStream(this.ctx, id, opts);
  }

  async cancel(id: string): Promise<Task> {
    return toTask(await cancelTask(this.ctx, id));
  }

  async delete(id: string, opts: { purge?: boolean } = {}): Promise<void> {
    return deleteTask(this.ctx, id, opts);
  }

  /**
   * @internal Test-only: await all in-flight background purges
   * enqueued by `delete({ purge: true })`. Underscore prefix marks
   * this as a test seam, not public API.
   */
  async _drainPendingPurgesForTest(): Promise<void> {
    return drainPendingPurges(this.ctx);
  }

  async recoverOrphaned(): Promise<void> {
    return recoverOrphaned(this.ctx);
  }

  liveCount(): number {
    return liveCount(this.ctx);
  }

  async shutdown(): Promise<void> {
    return shutdownService(this.ctx);
  }

  /**
   * Release manager-owned resources. Currently a no-op because the DB
   * handle is owned by `composeTaskModule`. `shutdown()` does NOT
   * call this so consumers can still inspect persisted state after
   * shutdown. Idempotent.
   */
  close(): void {
    // no-op — db lifecycle owned by composeTaskModule
  }

  async resolveArtifactPath(id: string, name: string): Promise<string | null> {
    return resolveArtifactPath(this.ctx, id, name);
  }
}

function defaultRandomBytes(n: number): Buffer {
  return cryptoRandomBytes(n);
}

function toTask(task: TaskEntity): Task {
  return task.toJSON();
}

/**
 * Pull a runtime-shaped session id from the task's open-shape
 * metadata bag. Returns null when the field is missing or not a
 * string. Lives on the facade module so queries, activity-stream,
 * and mutations can all share it without a 6th file.
 */
export function pickRuntimeSessionId(metadata: Readonly<Record<string, unknown>>): string | null {
  const v = metadata.runtimeSessionId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
