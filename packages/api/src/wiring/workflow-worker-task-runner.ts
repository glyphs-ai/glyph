/**
 * `makeWorkerNodeRunner` — the worker-kind {@link
 * WorkflowNodeRunner} that maps a workflow worker node to a
 * `@glyphs-ai/task` task.
 *
 * Sole module knowing about all of `@glyphs-ai/workflow`,
 * `@glyphs-ai/task`, AND `@glyphs-ai/catalog`. This is the only edge in
 * the cross-pkg import graph where the three meet — the workflow pkg
 * stays kind-agnostic (its `WorkflowNodeRunner` interface is the
 * seam); the task pkg stays unaware of workflows' DAG; and the
 * catalog pkg is consumed only here for agent existence.
 *
 * Responsibilities (the kind-specific concerns the workflow pkg
 * deliberately doesn't carry, absorbed here):
 *
 *   - worker spec-shape validation
 *   - agent existence lookup (mirroring `schedule-task-handler.ts`)
 *   - origin/originId synthesis for `tasks.dispatchTask.execute`
 *   - polling `tasks.get(...)` to discover terminal status
 *   - mapping `TaskStatus` → `WorkflowNodeTerminalResult`
 *   - bookkeeping the per-node `setInterval` handle so `dispose()`
 *     and `cancel(nodeId)` can clear it without leaking timers
 *
 * `validate(spec, _)` checks the inbound payload shape and verifies
 * the named agent exists in the catalog, surfacing a missing / failed
 * lookup as task's `AgentNotFound` / `AgentUnresolvable` union
 * — matching `schedule-task-handler.ts`'s precedent.
 *
 * Agent errors propagate as raw task DU atoms so the schedule / workflow
 * error policies resolve their HTTP status from the same `codeStatuses`
 * table as the task routes.
 *
 * # Why `setInterval` lives here, not in `@glyphs-ai/workflow/_engine.ts`
 *
 * The engine is event-driven and contains zero timers. Polling
 * cadence is the runner's concern because it is per-host: a worker
 * driven by `@glyphs-ai/task` polls a sqlite read every 2s; a
 * different host could choose a different cadence (or skip polling
 * entirely and push terminal state via an in-process event).
 * Centralizing this would force one cadence on every host — and
 * would still need a runner-side "tell me when the unit
 * terminated" callback for non-poll hosts. Keep polling local;
 * push terminal state up via `onTerminal`.
 *
 * # Spec invariants honored
 *
 * - The node's id lives in the task's typed `origin_id` column
 *   (`origin: "workflow"`, `originId: nodeId`). This module never
 *   asks the substrate to persist the task id; reverse-lookup goes
 *   through that column via
 *   `hasInFlightByOrigin` / `listInFlightByOrigin`.
 * - `onTerminal` is fired exactly once per dispatched node by this
 *   runner (the interval is cleared the moment a terminal status is
 *   observed, and the per-node Map entry is dropped at the same time).
 * - `dispatch` returns `void`. The runner logs the substrate-side
 *   identifier (the task id) at info level inside `dispatch` so
 *   operators can correlate substrate events with the underlying
 *   task; the substrate explicitly does NOT persist that id because
 *   reverse-lookup goes through the unit's typed `origin_id` column.
 * - No retry, no exponential backoff at the runner level; a single
 *   runner-local poll-error budget (`maxPollErrors`, default 3)
 *   maps repeated `tasks.get` failures to
 *   `onTerminal({status: 'failed', reason: 'tasks.get exhausted: ...'})`.
 */

import type {
  GetTaskResponse,
  ListInFlightByOriginResponse,
  TaskId,
  TaskModule,
} from "@glyphs-ai/task";
import { TaskBriefSchema } from "@glyphs-ai/task";
import type {
  RunnerFault,
  WorkflowNodeArtifactListing,
  WorkflowNodeRunner,
  WorkflowNodeTerminalResult,
  WorkflowNodeValidateCtx,
} from "@glyphs-ai/workflow";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { taskAgentNotFound, taskAgentUnresolvable } from "./_task-operation-error.js";
import type { WorkflowWorkerNodeSpec } from "./workflow-node-specs.js";

const silentLogger: Logger = pino({ level: "silent" });

interface CatalogAgent {
  readonly dependencies?: { readonly agents?: readonly { readonly fqn: string }[] };
}

interface CatalogAgentLookup {
  getAgent(fqn: string): Promise<CatalogAgent | null>;
}

/** Default poll cadence for `tasks.get(taskId)` in the worker runner. */
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 2000;
/** Default runner-local poll-error budget before surfacing as failed. */
export const DEFAULT_WORKER_MAX_POLL_ERRORS = 3;

/**
 * Wire-shape error for a malformed worker node spec. Lives next to
 * the handler (rather than in `@glyphs-ai/workflow`) because the
 * workflow pkg is kind-agnostic.
 */
export class WorkflowWorkerSpecError extends Error {
  override readonly name = "WorkflowWorkerSpecError";
}

/**
 * Capability error for a worker node whose `spec.agent` is not a
 * member of the workflow coordinator's `dependencies.agents` dispatch
 * menu. The coordinator FQN arrives via `ctx.coordinatorAgent`, which
 * the substrate denormalizes from the workflow row. The coord's menu is
 * fetched from the catalog at validate time. Lives next to
 * {@link WorkflowWorkerSpecError}
 * so all worker-runner validate-time rejections sit at one canonical
 * match point for downstream error policy.
 */
export class WorkflowWorkerNotInCoordMenuError extends Error {
  override readonly name = "WorkflowWorkerNotInCoordMenuError";
  constructor(
    public readonly workerAgentFqn: string,
    public readonly coordAgentFqn: string,
    public readonly coordMenu: readonly string[],
  ) {
    super(
      `Worker node spec agent "${workerAgentFqn}" is not in coordinator ` +
        `"${coordAgentFqn}"'s dispatch menu (\`dependencies.agents\`: ` +
        `[${coordMenu.map((m) => `"${m}"`).join(", ")}]). Add the agent to ` +
        `the coord's frontmatter, or pick an agent already in the menu.`,
    );
  }
}

export interface MakeWorkerNodeRunnerOpts {
  readonly tasks: TaskModule;
  readonly catalog: CatalogAgentLookup;
  readonly logger?: Logger;
  /**
   * Override the default `tasks.get(...)` poll cadence. Tests pass
   * a low value (e.g. 50ms) so end-to-end scenarios complete in
   * vitest's tight budget; production callers rely on the default.
   */
  readonly pollIntervalMs?: number;
  /**
   * Override the runner-local poll-error budget. Consecutive
   * `tasks.get` failures landing on the same node beyond this count
   * surface as `onTerminal({status: 'failed', reason: '...'})`.
   */
  readonly maxPollErrors?: number;
}

/**
 * Factory for the worker-kind runner. Returns the {@link
 * WorkflowNodeRunner} the workflow substrate consumes, augmented
 * with a `dispose()` method the test composition's shutdown step
 * calls to clear any leaked polling intervals.
 *
 * The `dispose()` method is on the returned object's intersection
 * type, NOT on the `WorkflowNodeRunner` interface — the interface
 * keeps the 4-method contract (`validate / dispatch /
 * hasInFlightForNode / cancel`).
 */
export function makeWorkerNodeRunner(
  opts: MakeWorkerNodeRunnerOpts,
): WorkflowNodeRunner & { dispose(): Promise<void> } {
  const tasks = opts.tasks;
  const catalog = opts.catalog;
  const logger = opts.logger ?? silentLogger;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_WORKER_POLL_INTERVAL_MS;
  const maxPollErrors = opts.maxPollErrors ?? DEFAULT_WORKER_MAX_POLL_ERRORS;

  // Per-node interval handle. Cleared on terminal observation,
  // explicit cancel, or runner dispose. Without this the runner
  // leaks `setInterval` handles and the test process can't exit.
  const intervals = new Map<string, NodeJS.Timeout>();

  /**
   * Tear down the polling interval for `nodeId`. Idempotent — safe
   * to call when there's no recorded interval (e.g. terminal
   * observed before any tick fired).
   */
  const clearForNode = (nodeId: string): void => {
    const handle = intervals.get(nodeId);
    if (handle === undefined) return;
    clearInterval(handle);
    intervals.delete(nodeId);
  };

  /**
   * Fire `onTerminal` for `nodeId` and tear down the interval in
   * the SAME synchronous step so a slow `onTerminal` callback can't
   * be racing with a still-armed poll tick.
   */
  const fireTerminal = (
    nodeId: string,
    result: WorkflowNodeTerminalResult,
    onTerminal: (result: WorkflowNodeTerminalResult) => void,
  ): void => {
    clearForNode(nodeId);
    try {
      onTerminal(result);
    } catch (err) {
      logger.warn(
        { nodeId, err, result },
        "workflow-worker-task-runner: onTerminal callback threw",
      );
    }
  };

  return {
    validate(spec: unknown, ctx: WorkflowNodeValidateCtx) {
      return new ResultAsync(
        (async (): Promise<Result<WorkflowWorkerNodeSpec, RunnerFault>> => {
          if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
            return err({
              cause: new WorkflowWorkerSpecError("Worker node spec must be an object"),
            });
          }
          const obj = spec as Record<string, unknown>;
          if (typeof obj.agent !== "string" || obj.agent.trim().length === 0) {
            return err({
              cause: new WorkflowWorkerSpecError("Worker node spec requires non-empty agent"),
            });
          }
          const briefResult = TaskBriefSchema.safeParse(obj.brief);
          if (!briefResult.success) {
            return err({
              cause: new WorkflowWorkerSpecError(
                `Worker node spec ${briefResult.error.issues[0]?.message ?? "has an invalid brief"}`,
              ),
            });
          }
          if (obj.details !== undefined && typeof obj.details !== "string") {
            return err({
              cause: new WorkflowWorkerSpecError(
                "Worker node spec details, when set, must be a string",
              ),
            });
          }
          if (
            obj.runtime !== undefined &&
            (typeof obj.runtime !== "string" || obj.runtime.trim().length === 0)
          ) {
            return err({
              cause: new WorkflowWorkerSpecError(
                "Worker node spec runtime, when set, must be a non-empty string",
              ),
            });
          }

          // Catalog existence — mirror schedule-task-handler.ts. Always
          // checked at validate time for workflow worker nodes (unlike
          // schedules, the workflow pkg does not propagate a `changedKeys`
          // hint into `validate`).
          let found: Awaited<ReturnType<typeof catalog.getAgent>>;
          try {
            found = await catalog.getAgent(obj.agent);
          } catch (cause) {
            return err({ cause: taskAgentUnresolvable(obj.agent, cause) });
          }
          if (found === null) return err({ cause: taskAgentNotFound(obj.agent) });

          // Workflow worker menu-membership discipline: a worker's
          // spec.agent MUST be a member of the workflow coordinator's
          // `dependencies.agents` dispatch menu. The coord FQN is threaded
          // in via `ctx.coordinatorAgent` (denormalized from
          // `workflow.coordinator_agent` by the substrate). Worker runners
          // re-fetch the coord agent here rather than receiving the
          // pre-resolved menu so the workflow pkg can stay kind-agnostic
          // (no catalog import upstream).
          let coordAgent: Awaited<ReturnType<typeof catalog.getAgent>>;
          try {
            coordAgent = await catalog.getAgent(ctx.coordinatorAgent);
          } catch (cause) {
            return err({ cause: taskAgentUnresolvable(ctx.coordinatorAgent, cause) });
          }
          if (coordAgent === null) {
            // Defensive: the substrate denorm should have kept this in
            // sync, but if the coord was uninstalled mid-workflow we
            // surface as not-found rather than mis-attribute as a
            // menu-membership failure.
            return err({ cause: taskAgentNotFound(ctx.coordinatorAgent) });
          }
          const menu = (coordAgent.dependencies?.agents ?? []).map((d) => d.fqn);
          if (!menu.includes(obj.agent)) {
            return err({
              cause: new WorkflowWorkerNotInCoordMenuError(obj.agent, ctx.coordinatorAgent, menu),
            });
          }

          const validated: WorkflowWorkerNodeSpec = {
            agent: obj.agent,
            brief: briefResult.data,
            ...(obj.details !== undefined ? { details: obj.details } : {}),
            ...(obj.runtime !== undefined ? { runtime: obj.runtime } : {}),
          };
          return ok(validated);
        })(),
      );
    },

    dispatch(opts) {
      return new ResultAsync(
        (async (): Promise<Result<void, RunnerFault>> => {
          const spec = opts.spec as WorkflowWorkerNodeSpec;
          const dispatchResult = await tasks.dispatchTask.execute({
            agent: spec.agent,
            brief: TaskBriefSchema.parse(spec.brief),
            ...(spec.details !== undefined ? { details: spec.details } : {}),
            ...(spec.runtime !== undefined ? { runtime: spec.runtime } : {}),
            origin: "workflow",
            originId: opts.nodeId,
            // `workflowId` stays in metadata for log correlation only; the
            // node reverse-lookup id lives in the typed `origin_id` column
            // (`originId`), consumed by `hasInFlightByOrigin`.
            metadata: {
              workflowId: opts.workflowId,
            },
            // Worker tasks see the two workflow identity keys
            // (`GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`) but NOT
            // `GLYPH_WORKFLOW_DIR` — the per-workflow shared dir is
            // coord-only by design. Coord owns that dir; workers stay
            // workflow-unaware so the coord skill's "workers do not
            // read the shared dir" rule holds by construction. The
            // restriction is doc-only — the runtime does not enforce
            // read-only on the dir, so the discipline is: do NOT add
            // the key here unless a deliberate spec change widens the
            // contract.
            //
            // No `prompt` override: workers use `@glyphs-ai/task`'s default
            // `DEFAULT_TASK_FRAMING_PROMPT`. Worker briefs are self-
            // contained TASK.md bodies; the default framing's "read
            // TASK.md, then exit" instruction is exactly right.
            subprocessEnv: {
              GLYPH_WORKFLOW_ID: opts.workflowId,
              GLYPH_NODE_ID: opts.nodeId,
            },
          });
          if (dispatchResult.isErr()) return err({ cause: dispatchResult.error });
          const task = dispatchResult.value;
          const taskId = task.id;
          const nodeId = opts.nodeId;
          const onTerminal = opts.onTerminal;
          logger.info(
            { workflowId: opts.workflowId, nodeId, taskId },
            "workflow-worker-task-runner: dispatched worker task",
          );

          // If a previous dispatch on the same nodeId left an orphan
          // interval (shouldn't happen — the substrate guarantees a
          // single in-flight per node — but defense-in-depth in case a
          // test re-runs dispatch directly), wipe it before installing
          // the new one.
          clearForNode(nodeId);

          let consecutivePollErrors = 0;
          const handle = setInterval(() => {
            // Fire-and-forget: setInterval callbacks can't be async,
            // and any error we don't catch here would crash the process.
            void (async () => {
              let task: GetTaskResponse;
              try {
                const getResult = await tasks.getTask.execute({ id: taskId as TaskId });
                if (getResult.isErr()) throw taskUseCaseError(getResult.error);
                task = getResult.value;
              } catch (err) {
                consecutivePollErrors += 1;
                logger.warn(
                  {
                    workflowId: opts.workflowId,
                    nodeId,
                    taskId,
                    consecutivePollErrors,
                    err,
                  },
                  "workflow-worker-task-runner: tasks.get threw",
                );
                if (consecutivePollErrors >= maxPollErrors) {
                  fireTerminal(
                    nodeId,
                    {
                      status: "failed",
                      reason: `tasks.get exhausted: ${maxPollErrors} consecutive failures (last: ${
                        err instanceof Error ? err.message : String(err)
                      })`,
                    },
                    onTerminal,
                  );
                }
                return;
              }
              consecutivePollErrors = 0;
              if (task === null) {
                // Task deleted out from under us. Surface as a failure
                // with reason "task not found" — the workflow node has
                // no unit-of-work to wait on any more.
                fireTerminal(
                  nodeId,
                  {
                    status: "failed",
                    reason: "task not found",
                  },
                  onTerminal,
                );
                return;
              }
              switch (task.status) {
                case "running":
                  return;
                case "succeeded":
                  fireTerminal(
                    nodeId,
                    {
                      status: "succeeded",
                      output: task.success ?? null,
                    },
                    onTerminal,
                  );
                  return;
                case "failed":
                  fireTerminal(
                    nodeId,
                    {
                      status: "failed",
                      reason: task.failure?.message ?? "task failed (no reason recorded)",
                      output: task.failure ?? null,
                    },
                    onTerminal,
                  );
                  return;
                case "cancelled":
                  fireTerminal(
                    nodeId,
                    {
                      status: "cancelled",
                      reason: task.cancellation?.message ?? "task cancelled (no reason recorded)",
                    },
                    onTerminal,
                  );
                  return;
                default: {
                  // Defense against an unknown TaskStatus arm we don't
                  // know about. Treat as failure rather than silently
                  // dropping; the runner is the layer that owns the
                  // mapping and should fail loudly if it drifts.
                  const unexpected: never = task.status;
                  fireTerminal(
                    nodeId,
                    {
                      status: "failed",
                      reason: `workflow-worker-task-runner: unexpected task status: ${unexpected as string}`,
                    },
                    onTerminal,
                  );
                }
              }
            })();
          }, pollIntervalMs);
          intervals.set(nodeId, handle);
          return ok(undefined);
        })(),
      );
    },

    hasInFlightForNode(nodeId: string) {
      return tasks.hasInFlightByOrigin
        .execute({
          origin: "workflow",
          originId: nodeId,
        })
        .mapErr((cause): RunnerFault => ({ cause: taskUseCaseError(cause) }));
    },

    cancel(nodeId: string) {
      return new ResultAsync(
        (async (): Promise<Result<void, RunnerFault>> => {
          // Tear down the local interval FIRST so a poll-tick can't race
          // ahead and observe the cancellation as a generic terminal.
          clearForNode(nodeId);
          let inFlight: ListInFlightByOriginResponse;
          try {
            const result = await tasks.listInFlightByOrigin.execute({
              origin: "workflow",
              originId: nodeId,
            });
            if (result.isErr()) throw taskUseCaseError(result.error);
            inFlight = result.value;
          } catch (err) {
            logger.warn(
              { nodeId, err },
              "workflow-worker-task-runner: listInFlightByOrigin threw during cancel",
            );
            return ok(undefined);
          }
          // Best-effort, idempotent — per `WorkflowNodeRunner` contract.
          // A throw on one task doesn't abort the others; we log and
          // continue.
          for (const t of inFlight) {
            try {
              const result = await tasks.cancelTask.execute({ id: t.id });
              if (result.isErr()) throw taskUseCaseError(result.error);
            } catch (err) {
              logger.warn(
                { nodeId, taskId: t.id, err },
                "workflow-worker-task-runner: tasks.cancel threw",
              );
            }
          }
          return ok(undefined);
        })(),
      );
    },

    listArtifacts(nodeId: string) {
      return tasks.findLatestByOrigin
        .execute({
          origin: "workflow",
          originId: nodeId,
        })
        .mapErr((cause): RunnerFault => ({ cause: taskUseCaseError(cause) }))
        .andThen((task): ResultAsync<WorkflowNodeArtifactListing | null, RunnerFault> => {
          if (task === null) return okAsync(null);
          // The task module owns its artifact listing (relPath + size + mtime);
          // this bridge just maps node → task and forwards.
          return tasks.listArtifacts
            .execute({ id: task.id })
            .map((artifacts): WorkflowNodeArtifactListing => ({ artifacts }))
            .mapErr((cause): RunnerFault => ({ cause: taskUseCaseError(cause) }));
        });
    },

    resolveArtifactPath(nodeId: string, relPath: string) {
      return tasks.findLatestByOrigin
        .execute({
          origin: "workflow",
          originId: nodeId,
        })
        .mapErr((cause): RunnerFault => ({ cause: taskUseCaseError(cause) }))
        .andThen((task): ResultAsync<string | null, RunnerFault> => {
          if (task === null) return okAsync(null);
          return tasks.resolveArtifactPath
            .execute({ id: task.id, relPath })
            .mapErr((cause): RunnerFault => ({ cause: taskUseCaseError(cause) }));
        });
    },

    async dispose(): Promise<void> {
      for (const handle of intervals.values()) {
        clearInterval(handle);
      }
      intervals.clear();
    },
  };
}

function taskUseCaseError(err: { readonly type: string; readonly cause?: unknown }): Error {
  return err.cause instanceof Error ? err.cause : new Error(err.type);
}
