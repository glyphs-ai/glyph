/**
 * Stateful lifecycle service shared by the dispatch / cancel / delete
 * use-cases. Owns the supervision state that outlives any single use-case call:
 *
 *   - `dispatchInProgress` — ids between workdir reservation and the point the
 *                            spawned process is handed to the registry, so
 *                            `liveCount` sees in-flight dispatches as live.
 *   - `shuttingDown`       — gates new dispatches + cancels once shutdown starts.
 *
 * Physical cleanup (`purge`) is synchronous and idempotent, run by the delete
 * use-cases BEFORE they remove the DB row (the row is the durable journal a
 * crash leaves behind for retry) — there is no background purge queue.
 *
 * The live subprocesses themselves are held by an injected
 * {@link LiveProcessRegistry}: this service never touches a `RuntimeHandle`
 * directly, it delegates spawn-handoff / kill / drain to the registry and keeps
 * only the orchestration (what to persist on exit, cancel rules, purge).
 *
 * The `TaskEntity` value type IS the FSM; this service orchestrates persistence
 * + subprocess side effects around it. It consumes the runtime Result rail
 * natively — no throws cross its method boundaries.
 */

import type {
  AgentContentSource,
  ResolvedAgent,
  Runtime,
  RuntimeHeadlessLaunchFailed,
  RuntimeRegistry,
} from "@glyphs-ai/runtime";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";
import type { TaskBrief } from "../../domain/task-brief.js";
import {
  type CorruptedTask,
  type InvalidTransition,
  TaskEntity,
} from "../../domain/task-entity.js";
import type { TaskId } from "../../domain/task-id.js";
import type { TaskOrigin } from "../../domain/task-origin.js";
import type {
  DatabaseUnavailable,
  TaskNotFound,
  TaskRepository,
} from "../../domain/task-repository.js";
import type {
  TaskSandbox,
  WorkdirMaterializationFailed,
  WorkdirReservationFailed,
} from "../../domain/task-sandbox.js";
import type { ExitOutcome, LiveProcessRegistry } from "../ports/live-process-registry.js";
import {
  decideTerminal,
  TASK_OUTPUT_MAX_CHARS,
  type TerminalDecision,
} from "./terminal-decision.js";

/** Default runtime kind used when a dispatch omits an explicit runtime. */
export const DEFAULT_RUNTIME = "copilot";

/** A runtime narrowed to the subset on which `launchHeadless` is guaranteed present. */
export type LaunchableRuntime = Runtime & {
  launchHeadless: NonNullable<Runtime["launchHeadless"]>;
};

/**
 * A framing prompt safe to pass through `cmd.exe /c …` as one argv element: no
 * LF, no CR, printable ASCII only (0x20–0x7E). The single source of truth for
 * the framing-prompt invariant — the dispatch request's `prompt` override, the
 * default framing, and any caller override all validate against it.
 */
export const FramingPromptSchema = z
  .string()
  .refine(
    (s) => !s.includes("\n") && !s.includes("\r") && !/[^\x20-\x7E]/.test(s),
    "framing prompt must be single-line printable ASCII",
  );

/**
 * Prepared inputs to `TaskSupervisor.runDispatch`; the dispatch use-case has
 * already resolved the agent, picked + narrowed the runtime, and validated the
 * framing prompt + caller env before handing these over.
 */
export interface RunDispatchArgs {
  readonly id: TaskId;
  /** The requested agent name, stored on the task row verbatim. */
  readonly agent: string;
  /** The resolved agent handed to `runtime.launchHeadless`. */
  readonly resolved: ResolvedAgent;
  readonly runtime: LaunchableRuntime;
  /** Framing prompt validated by {@link FramingPromptSchema}. */
  readonly framingPrompt: string;
  readonly brief: TaskBrief;
  readonly details: string | undefined;
  readonly origin: TaskOrigin;
  readonly originId: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  readonly subprocessEnv: Readonly<Record<string, string>> | undefined;
}

/** `dispatch` / `cancel`: the supervisor has begun shutting down; retry after restart. */
export type ManagerShuttingDown = {
  readonly type: "ManagerShuttingDown";
};

/**
 * `purge` couldn't fully remove a task's physical resources (runtime state or
 * workdir). The caller leaves the DB row in place so a later delete retry
 * re-runs the (idempotent) purge instead of orphaning the resources.
 */
export type PurgeFailed = {
  readonly type: "PurgeFailed";
  readonly taskId: string;
  readonly cause: unknown;
};

/** Faults surfaced by {@link TaskSupervisor.runDispatch} (the stateful spawn pipeline). */
type RunDispatchError =
  | WorkdirReservationFailed
  | WorkdirMaterializationFailed
  | DatabaseUnavailable
  | RuntimeHeadlessLaunchFailed
  | ManagerShuttingDown;

/** Faults surfaced by {@link TaskSupervisor.cancel}. */
type CancelError =
  | ManagerShuttingDown
  | TaskNotFound
  | InvalidTransition
  | CorruptedTask
  | DatabaseUnavailable;

export interface TaskSupervisorDeps {
  readonly repository: TaskRepository;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: TaskSandbox;
  /** Holds the live subprocesses this manager owns; the handle mechanics live here. */
  readonly liveProcesses: LiveProcessRegistry;
  readonly contentSource: AgentContentSource;
  readonly workspaceId: string;
  readonly workspaceDir: string;
  readonly now: () => Date;
  readonly logger: Logger;
}

export class TaskSupervisor {
  private readonly deps: TaskSupervisorDeps;
  private readonly dispatchInProgress = new Set<string>();
  private shuttingDown = false;

  constructor(deps: TaskSupervisorDeps) {
    this.deps = deps;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Tasks the manager is currently supervising: live subprocesses (from the
   * registry) plus dispatches mid-flight (workdir reserved, row written, not
   * yet handed to the registry). Callers use it to refuse destructive
   * operations (e.g. workspace cache reload) while work is in flight.
   */
  liveCount(): number {
    return this.deps.liveProcesses.size() + this.dispatchInProgress.size;
  }

  /**
   * Reserve the workdir, persist the initial row, materialise `TASK.md` +
   * subdirs, spawn the headless subprocess, fold the runtime session id back
   * into metadata, and hand the process to the registry (which arms the exit
   * watcher). Pre-spawn failures roll the workdir + row back entirely; a
   * post-spawn shutdown kills the subprocess and rolls back. `dispatchInProgress`
   * is held for the whole flow so a concurrent `liveCount()` never sees a gap.
   */
  runDispatch(args: RunDispatchArgs): ResultAsync<TaskEntity, RunDispatchError> {
    return new ResultAsync(this.dispatchToCompletion(args));
  }

  private async dispatchToCompletion(
    args: RunDispatchArgs,
  ): Promise<Result<TaskEntity, RunDispatchError>> {
    const reserved = await this.deps.sandbox.reserve(args.id);
    if (reserved.isErr()) return err(reserved.error);
    const workdir = reserved.value;

    this.dispatchInProgress.add(args.id);
    try {
      return await this.spawnInWorkdir(args, workdir);
    } finally {
      this.dispatchInProgress.delete(args.id);
    }
  }

  private async spawnInWorkdir(
    args: RunDispatchArgs,
    workdir: string,
  ): Promise<Result<TaskEntity, RunDispatchError>> {
    const { id, runtime } = args;
    const createdAt = this.deps.now().toISOString();
    // Spread order: caller metadata first, kernel keys (workdir, runtime)
    // override — callers may tag a task without spoofing the runtime column.
    const initialMeta: Record<string, unknown> = {
      ...(args.metadata ?? {}),
      workdir,
      runtime: runtime.kind,
    };
    const initial = TaskEntity.create({
      id,
      agent: args.agent,
      brief: args.brief,
      ...(args.details !== undefined ? { details: args.details } : {}),
      origin: args.origin,
      ...(args.originId !== undefined ? { originId: args.originId } : {}),
      createdAt,
      metadata: initialMeta,
    });

    const saved = await this.deps.repository.save(initial);
    if (saved.isErr()) {
      await this.rollback(id, workdir);
      return err(saved.error);
    }

    const materialized = await this.deps.sandbox.materialize({
      workdir,
      brief: args.brief,
      details: args.details,
    });
    if (materialized.isErr()) {
      await this.rollback(id, workdir);
      return err(materialized.error);
    }

    // Spawn. Kernel env keys FIRST, caller bag LAST — the caller bag is
    // guaranteed (by the dispatch use-case's pre-check) never to carry a
    // kernel key, so the kernel keys always win the merge. `brief` + `details`
    // are NOT passed via argv; they live in `<workdir>/TASK.md` and the
    // framing prompt tells the agent to read it.
    const launched = await runtime.launchHeadless({
      workdir,
      agent: args.resolved,
      catalog: this.deps.contentSource,
      prompt: args.framingPrompt,
      workspaceDir: this.deps.workspaceDir,
      subprocessEnv: {
        GLYPH_WORKSPACE: this.deps.workspaceId,
        GLYPH_WORKSPACE_DIR: this.deps.workspaceDir,
        GLYPH_WORK_KIND: "task",
        GLYPH_WORK_ID: id,
        GLYPH_WORK_DIR: workdir,
        ...(args.subprocessEnv ?? {}),
      },
    });
    if (launched.isErr()) {
      await this.rollback(id, workdir);
      return err(launched.error);
    }
    const handle = launched.value;

    // Re-check shutdown after the spawn await: a SIGTERM-driven shutdown()
    // could have flipped the flag while launchHeadless yielded the event loop.
    // The process isn't in the registry yet, so shutdown()'s killAll would miss
    // it — kill it here and roll back.
    if (this.shuttingDown) {
      try {
        handle.kill();
      } catch {
        // Already dead.
      }
      try {
        await handle.exit;
      } catch {
        // exit promise should never reject by construction.
      }
      await this.rollback(id, workdir);
      return err({ type: "ManagerShuttingDown" });
    }

    // Fold the runtime session id into metadata. Persistence failure here is
    // not rolled back — the subprocess is live, and terminal persistence will
    // retry with the same enriched metadata.
    const running = initial;
    if (handle.runtimeSessionId !== undefined) {
      running.replaceMetadata({
        ...running.metadata,
        runtimeSessionId: handle.runtimeSessionId,
      });
      const savedRunning = await this.deps.repository.save(running);
      if (savedRunning.isErr()) {
        this.deps.logger.warn(
          { taskId: id, err: savedRunning.error },
          "tasks: failed to persist runtime session id; terminal save will retry metadata",
        );
      }
    }

    // Hand the live subprocess to the registry. It watches for exit and calls
    // back into `persistTerminal`, then drops the entry.
    this.deps.liveProcesses.supervise(id, handle, (outcome, killReason) =>
      this.persistTerminal(workdir, running, outcome, killReason),
    );
    return ok(running);
  }

  /**
   * User-initiated cancellation of a running task. Delegates the kill to the
   * registry and awaits the exit watcher's terminal persistence. Terminal input
   * → `InvalidTransition`; a concurrent same-id cancel: the first call owns the
   * kill, every later call returns `InvalidTransition` after awaiting settlement.
   * The orphan path (no live process) synthesises a `cascade` cancellation so
   * the persisted row matches the normal-path shape.
   */
  cancel(id: TaskId): ResultAsync<TaskEntity, CancelError> {
    return new ResultAsync(this.cancelToCompletion(id));
  }

  private async cancelToCompletion(id: TaskId): Promise<Result<TaskEntity, CancelError>> {
    if (this.shuttingDown) return err({ type: "ManagerShuttingDown" });
    if (this.dispatchInProgress.has(id)) {
      return err({
        type: "InvalidTransition",
        from: "running",
        eventType: "cancel-during-dispatch",
      });
    }

    const existingResult = await this.deps.repository.get(id);
    if (existingResult.isErr()) return err(existingResult.error);
    const existing = existingResult.value;
    if (existing.status !== "running") {
      return err({ type: "InvalidTransition", from: existing.status, eventType: "cancel" });
    }

    const outcome = this.deps.liveProcesses.requestKill(id, "cancel");
    if (outcome === "not-live") {
      // Orphan path: no live subprocess. Synthesise a cascade cancellation so
      // the persisted row shape matches the normal path.
      this.deps.logger.warn(
        { taskId: id },
        "tasks: cancelling row in running status with no live subprocess (orphan)",
      );
      const applied = await this.applyTerminal(this.deps.sandbox.resolve(id), existing, {
        kind: "cancelled",
        cancellation: { kind: "cascade", message: "cancelled (recovered from inconsistent state)" },
      });
      if (applied.isErr()) return err(applied.error);
    } else {
      await this.deps.liveProcesses.awaitSettled(id);
      if (outcome === "already-killing") {
        return err({ type: "InvalidTransition", from: "cancelled", eventType: "cancel" });
      }
    }

    const finalResult = await this.deps.repository.get(id);
    if (finalResult.isErr()) return err(finalResult.error);
    return ok(finalResult.value);
  }

  /**
   * Kill every live subprocess, await their exit + post-exit persistence, and
   * stop accepting new dispatches. Idempotent — a repeat call just drains any
   * processes still settling.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.deps.liveProcesses.killAll("shutdown");
  }

  /**
   * Physically purge a terminal task's runtime state + workdir. Idempotent
   * (rmdir of a missing dir / `deleteState` of a missing session are no-ops),
   * so the delete use-cases run it BEFORE removing the DB row: the row is the
   * durable journal a crash leaves behind, and a retry re-runs this safely.
   *
   * An unregistered runtime (dropped between dispatch and delete) is a logged
   * skip, not a failure — its state can no longer be addressed. A genuine IO
   * failure (`deleteState` / workdir rm) surfaces `PurgeFailed`; both steps are
   * still attempted so a single retry cleans up as much as possible.
   */
  purge(existing: TaskEntity): ResultAsync<void, PurgeFailed> {
    return new ResultAsync(this.runPurge(existing));
  }

  private async runPurge(existing: TaskEntity): Promise<Result<void, PurgeFailed>> {
    const id = existing.id;
    const workdir = this.deps.sandbox.resolve(existing.id);
    const runtimeName = existing.metadataString("runtime");
    const runtimeKey = runtimeName ?? DEFAULT_RUNTIME;
    // Unknown runtime (dropped from registry between dispatch and delete):
    // skip the runtime-side delete; still remove the workdir.
    const found = this.deps.runtimeRegistry.get(runtimeKey);
    const runtime: Runtime | undefined = found.isOk() ? found.value : undefined;

    let failureCause: unknown;
    if (runtime !== undefined) {
      const runtimeSessionId = existing.metadataString("runtimeSessionId");
      if (runtimeSessionId !== undefined) {
        const deleted = await runtime.deleteState(runtimeSessionId);
        if (deleted.isErr()) {
          this.deps.logger.warn(
            { err: deleted.error.cause, taskId: id, runtimeSessionId },
            "task.purge: runtime.deleteState failed; leaving row for retry",
          );
          failureCause = deleted.error.cause;
        }
      }
    }

    const removed = await this.deps.sandbox.remove(workdir);
    if (removed.isErr()) {
      this.deps.logger.warn(
        { err: removed.error.cause, taskId: id, workdir },
        "task.purge: workdir rm failed; leaving row for retry",
      );
      failureCause ??= removed.error.cause;
    }

    if (failureCause !== undefined) {
      return err({ type: "PurgeFailed", taskId: id, cause: failureCause });
    }
    return ok(undefined);
  }

  /**
   * Registry `onExit` callback: classify the exit into a terminal decision
   * (or `failed/internal` if the exit watch itself failed) and persist it.
   */
  private async persistTerminal(
    workdir: string,
    running: TaskEntity,
    outcome: ExitOutcome,
    killReason: "shutdown" | "cancel" | null,
  ): Promise<void> {
    const decision: TerminalDecision =
      outcome.kind === "exited"
        ? decideTerminal(outcome.exit, killReason)
        : {
            kind: "failed",
            failure: {
              kind: "internal",
              message: `exit watcher rejected: ${outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause)}`,
            },
          };
    await this.applyTerminal(workdir, running, decision);
  }

  private async applyTerminal(
    workdir: string,
    running: TaskEntity,
    decision: TerminalDecision,
  ): Promise<Result<void, DatabaseUnavailable>> {
    const now = this.deps.now().toISOString();
    let transition: Result<void, InvalidTransition>;
    switch (decision.kind) {
      case "succeeded": {
        const [output, artifacts] = await this.collectSuccessPayload(workdir, running);
        transition = running.complete({ output, artifacts }, { now });
        break;
      }
      case "failed":
        transition = running.fail(decision.failure, { now });
        break;
      case "cancelled":
        transition = running.cancel(decision.cancellation, { now });
        break;
    }
    if (transition.isErr()) {
      this.deps.logger.warn(
        { taskId: running.id, err: transition.error },
        "tasks: illegal terminal transition; persisted state left unchanged",
      );
      return ok(undefined);
    }
    // The persistence result is RETURNED so a caller that can still act on a
    // failure (the orphan-cancel path) surfaces it instead of reporting a
    // successful cancel over a row that never left `running`. The fire-and-forget
    // exit watcher discards it — the subprocess is already gone.
    const saved = await this.deps.repository.save(running);
    if (saved.isErr()) {
      this.deps.logger.warn(
        { taskId: running.id, err: saved.error },
        "tasks: failed to persist terminal status",
      );
      return err(saved.error);
    }
    return ok(undefined);
  }

  /**
   * Best-effort assembly of the success payload: the agent's last utterance
   * (capped, head-preserved) and the `artifact/` file list, gathered in
   * parallel. Any sub-failure degrades to `null` / `[]` and warns.
   */
  private async collectSuccessPayload(
    workdir: string,
    task: TaskEntity,
  ): Promise<[string | null, readonly string[]]> {
    return Promise.all([this.collectOutput(task), this.collectArtifacts(workdir, task.id)]);
  }

  private async collectOutput(task: TaskEntity): Promise<string | null> {
    const runtimeName = task.metadataString("runtime");
    const runtimeSessionId = task.metadataString("runtimeSessionId");
    if (runtimeName === undefined || runtimeSessionId === undefined) return null;
    const found = this.deps.runtimeRegistry.get(runtimeName);
    if (found.isErr()) return null;
    const runtime = found.value;
    if (typeof runtime.getLastAgentActivity !== "function") return null;
    // getLastAgentActivity is best-effort (never-failing Result) — a runtime
    // fault resolves to null rather than failing the read.
    const last = (await runtime.getLastAgentActivity(runtimeSessionId)).unwrapOr(null);
    if (last === null) return null;
    return last.text.slice(0, TASK_OUTPUT_MAX_CHARS);
  }

  private async collectArtifacts(workdir: string, taskId: string): Promise<readonly string[]> {
    const listed = await this.deps.sandbox.listArtifacts(workdir);
    if (listed.isErr()) {
      this.deps.logger.warn(
        { taskId, err: listed.error },
        "tasks: listArtifacts failed; artifacts left empty",
      );
      return [];
    }
    return listed.value.map((f) => f.relPath);
  }

  private async rollback(id: TaskId, workdir: string): Promise<void> {
    const removed = await this.deps.sandbox.remove(workdir);
    if (removed.isErr()) {
      this.deps.logger.warn(
        { taskId: id, workdir, err: removed.error },
        "tasks: failed to remove workdir during dispatch rollback",
      );
    }
    const deleted = await this.deps.repository.delete(id);
    if (deleted.isErr()) {
      this.deps.logger.warn(
        { taskId: id, err: deleted.error },
        "tasks: failed to remove task row during dispatch rollback",
      );
    }
  }
}
