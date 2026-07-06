// "task" in this filename refers to the @glyphs-ai/task dispatch
// mechanism this runner uses (visible at the tasks.dispatch call
// inside dispatch()), not the workflow-node wire `kind` — which is
// "coordinator" (this runner) or "worker" (sibling runner).

/**
 * `makeCoordNodeRunner` — the coordinator-kind {@link
 * WorkflowNodeRunner} that maps a workflow coordinator node to a
 * `@glyphs-ai/task` task.
 *
 * Structurally the same machine as `workflow-worker-task-runner.ts`
 * (worker): same per-node interval Map, same `clearForNode` /
 * `fireTerminal` helpers, same poll-tick state machine, same cancel
 * reconciliation, same dispose. The two runners are intentionally
 * duplicated rather than sharing helpers — not because either body is
 * small (neither is), but because the kind-specific halves (spec
 * validation, brief/details sourcing, and dispatch-payload assembly)
 * diverge enough that a shared base would need a kind-discriminated
 * branch at nearly every step, re-coupling two dispatch paths that are
 * otherwise free to evolve their polling cadence and spec shape
 * independently.
 *
 * Divergence from the worker runner:
 *
 *   - Spec shape: `{ agent }` only (worker is
 *     `{ agent, brief, details?, runtime? }`). Extra keys are
 *     rejected (strict).
 *   - The task's `brief` / `details` come from the workflow header
 *     (read via `getService().getWorkflow(workflowId)` at dispatch
 *     time), NOT from the node spec. Coordinators are launched at
 *     workflow-create time with `{ agent: args.coordinatorAgent }`
 *     and inherit the workflow's prose for their TASK.md body.
 *   - Two-phase init via the `getService` thunk: the workflow
 *     service is constructed by `composeWorkflowModule`, which
 *     itself requires the runners. The thunk lets the caller
 *     assign the service ref after compose returns — mirrors the
 *     engine ↔ service two-phase init in `@glyphs-ai/workflow`.
 *
 * # Why `setInterval` lives here, not in `@glyphs-ai/workflow/_engine.ts`
 *
 * Same rationale as the worker runner: polling cadence is per-host
 * (a host driven by `@glyphs-ai/task` polls sqlite every 2s; a
 * different host could push terminal state without polling). Keep
 * polling local; push terminal state up via `onTerminal`.
 *
 * # Spec invariants honored
 *
 *   - The node's id lives in the task's typed `origin_id` column
 *     (`origin: "workflow"`, `originId: nodeId`). Worker and
 *     coord runners use the SAME column — `hasInFlightByOrigin`
 *     covers both kinds via the `tasks_origin_pair_idx` partial index.
 *   - `onTerminal` is fired exactly once per dispatched node by this
 *     runner (the interval is cleared the moment a terminal status
 *     is observed, and the per-node Map entry is dropped at the same
 *     time).
 *   - `dispatch` returns `void`. The runner logs the substrate-side
 *     identifier (the task id) at info level inside `dispatch` so
 *     operators can correlate substrate events with the underlying
 *     task; the substrate explicitly does NOT persist that id because
 *     reverse-lookup goes through the unit's metadata.
 *   - No retry / no exponential backoff at the runner level; a
 *     single runner-local poll-error budget (`maxPollErrors`,
 *     default 3) maps repeated `tasks.get` failures to
 *     `onTerminal({status: 'failed', reason: 'tasks.get exhausted: ...'})`.
 */

import type {
  GetTaskResponse,
  ListInFlightByOriginResponse,
  TaskId,
  TaskModule,
} from "@glyphs-ai/task";
import { TaskBriefSchema } from "@glyphs-ai/task";
import {
  type RunnerFault,
  type WorkflowId,
  type WorkflowModule,
  type WorkflowNodeRunner,
  type WorkflowNodeTerminalResult,
  type WorkflowNodeValidateCtx,
  workflowDir,
} from "@glyphs-ai/workflow";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { taskAgentNotFound, taskAgentUnresolvable } from "./_task-operation-error.js";
import type { WorkflowCoordinatorNodeSpec } from "./workflow-node-specs.js";

const silentLogger: Logger = pino({ level: "silent" });

interface CatalogAgent {
  readonly dependencies?: { readonly agents?: readonly { readonly fqn: string }[] };
}

interface CatalogAgentLookup {
  getAgent(fqn: string): Promise<CatalogAgent | null>;
}

/** Default poll cadence for `tasks.get(taskId)` in the coord runner. */
export const DEFAULT_COORD_POLL_INTERVAL_MS = 2000;
/** Default runner-local poll-error budget before surfacing as failed. */
export const DEFAULT_COORD_MAX_POLL_ERRORS = 3;

/**
 * Framing prompt the spawned coordinator task subprocess receives in
 * place of `@glyphs-ai/task`'s default `DEFAULT_TASK_FRAMING_PROMPT`.
 *
 * The override exists because a coordinator needs a different opening
 * banner than a normal task: it must name the three workflow env keys
 * (`GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`, `GLYPH_WORKFLOW_DIR`)
 * the workflow substrate injects, point at TASK.md as workflow context
 * (not its per-wake-up assignment), defer the operational protocol to
 * the coord agent's own body, and provide an escape hatch for
 * undecidable state so an inconsistent workflow finishes as failed
 * rather than retrying indefinitely. Kept narrow to a banner; the
 * "what to do this wake-up" decision logic lives in the agent body,
 * not here.
 *
 * Single-line printable ASCII: cmd.exe `/c` argv treats LF as a
 * statement separator on Windows, so a multi-line prompt would be
 * truncated. A unit test asserts this invariant on the shipped
 * constant, and task re-validates the forwarded prompt on every
 * dispatch via `FramingPromptSchema`.
 */
export const COORD_FRAMING_PROMPT_COPILOT =
  "You are running as a workflow coordinator. " +
  "Identity: " +
  "GLYPH_WORKFLOW_ID -- the workflow you advance; " +
  "GLYPH_NODE_ID -- your coord-node id; " +
  "GLYPH_WORKFLOW_DIR -- per-workflow shared dir (read+write yours alone). " +
  "TASK.md holds the workflow's overall goal (not your per-wake-up assignment); " +
  "inspect current DAG state via the workflow CLI to decide what to do this wake-up. " +
  "The coordinator protocol you follow is defined in your agent body. " +
  "After applying your decision (workflow mutations and/or finish), end your response -- " +
  "the substrate will trigger the next phase. " +
  "Before calling workflow finish (succeeded, failed, or cancelled), save a single self-contained HTML summary under $GLYPH_WORKFLOW_DIR/artifact/ (choose a descriptive filename; inline all CSS, JS, fonts, images as data URLs; no external links or CDN references; must render correctly when opened directly from disk with no network access). The summary MUST include: (1) the complete workflow brief from TASK.md (not just the title -- the full goal and context), (2) a timeline table showing each node's role, agent, start time, duration, and final status, (3) a collapsible coordinator decisions section summarizing each wake-up's case match and action taken (which case from the strategy was matched, what nodes were dispatched or what finish outcome was chosen, and why), (4) for each completed worker node: a collapsible section with the node's key outputs and findings as determined by the strategy skill and the worker's artifact contents, (5) final outcome metrics (iterations count, deliverable URLs, any remaining open items). Use HTML details/summary elements for collapsible sections so the page is scannable at a glance but full detail is one click away. The goal: a reader seeing this HTML for the first time should understand every decision made and every result produced without needing to open the dashboard or read task activity logs. " +
  "If state is inconsistent or no next step is decidable, " +
  "finish the workflow as failed rather than retrying indefinitely.";

/**
 * Wire-shape error for a malformed coord node spec. Lives next to
 * the runner (rather than in `@glyphs-ai/workflow`) because the
 * workflow pkg is kind-agnostic. Mirrors {@link WorkflowWorkerSpecError}
 * placement in the sibling worker runner.
 */
export class WorkflowCoordSpecError extends Error {
  override readonly name = "WorkflowCoordSpecError";
}

/**
 * Capability error for a workflow coordinator agent whose catalog
 * frontmatter does not declare a non-empty `dependencies.agents`
 * dispatch menu. The coordinator needs the declared menu to validate
 * worker `spec.agent` values; without it, the coord-vs-task
 * architectural split (workflow = declared menu; task = open-ended)
 * collapses.
 *
 * Lives next to {@link WorkflowCoordSpecError} so all coord-runner
 * validate-time rejections sit at one canonical match point for
 * downstream error policy.
 */
export class WorkflowCoordAgentNotCapableError extends Error {
  override readonly name = "WorkflowCoordAgentNotCapableError";
  constructor(public readonly agentFqn: string) {
    super(
      `Workflow coordinator agent "${agentFqn}" declares no \`dependencies.agents\` ` +
        `dispatch menu in its catalog frontmatter. Workflow coordinators MUST declare ` +
        `the agents they may dispatch. If you need open-ended dispatch, use \`glyph task ` +
        `dispatch\` instead of \`glyph workflow create\`.`,
    );
  }
}

export interface MakeCoordNodeRunnerOpts {
  readonly tasks: TaskModule;
  readonly catalog: CatalogAgentLookup;
  /**
   * Lazy getter for the {@link WorkflowModule}. The runner needs it
   * to read the workflow header (`brief` / `details`) at dispatch
   * time, because `dispatch` opts hand the runner only the node-
   * level spec; `brief` / `details` live on the workflow row.
   *
   * Two-phase init: the workflow module is constructed by
   * `composeWorkflowModule`, which itself requires the runners.
   * Taking an eager `module: WorkflowModule` would make it
   * impossible for the caller to construct the runner before compose
   * returns. The thunk lets the caller capture a ref, build the
   * runner, call compose, then assign the ref — mirrors the engine
   * ↔ service two-phase init in `@glyphs-ai/workflow`.
   */
  readonly getModule?: () => WorkflowModule;
  readonly getService?: () => WorkflowModule;
  /**
   * Absolute path to the workspace root. The runner needs it so it
   * can resolve the per-workflow shared dir via
   * `workflowDir(workspaceDir, workflowId)` and inject the resolved
   * path as `GLYPH_WORKFLOW_DIR` into the dispatched coord task's
   * subprocess env. The workflow substrate creates the dir on
   * `createWorkflow`; the runner only reads its path — it never
   * mkdirs.
   *
   * Sourced from `workspace.workspaceDir` in `workspace-context.ts`
   * at compose time, alongside the workflow module construction.
   */
  readonly workspaceDir: string;
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
 * Factory for the coordinator-kind runner. Returns the {@link
 * WorkflowNodeRunner} the workflow substrate consumes, augmented
 * with a `dispose()` method the test composition's shutdown step
 * calls to clear any leaked polling intervals.
 *
 * The `dispose()` method is on the returned object's intersection
 * type, NOT on the `WorkflowNodeRunner` interface — the interface
 * keeps the 4-method contract (`validate / dispatch /
 * hasInFlightForNode / cancel`).
 */
export function makeCoordNodeRunner(
  opts: MakeCoordNodeRunnerOpts,
): WorkflowNodeRunner & { dispose(): Promise<void> } {
  const tasks = opts.tasks;
  const catalog = opts.catalog;
  const getModule = opts.getModule ?? opts.getService;
  const workspaceDir = opts.workspaceDir;
  const logger = opts.logger ?? silentLogger;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_COORD_POLL_INTERVAL_MS;
  const maxPollErrors = opts.maxPollErrors ?? DEFAULT_COORD_MAX_POLL_ERRORS;

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
      logger.warn({ nodeId, err, result }, "workflow-coord-task-runner: onTerminal callback threw");
    }
  };

  return {
    validate(spec: unknown, _ctx: WorkflowNodeValidateCtx) {
      return new ResultAsync(
        (async (): Promise<Result<WorkflowCoordinatorNodeSpec, RunnerFault>> => {
          if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
            return err({ cause: new WorkflowCoordSpecError("Coord node spec must be an object") });
          }
          const obj = spec as Record<string, unknown>;
          if (typeof obj.agent !== "string" || obj.agent.trim().length === 0) {
            return err({
              cause: new WorkflowCoordSpecError("Coord node spec requires non-empty agent"),
            });
          }
          // Strict shape: reject every key except `agent`. The coord
          // spec is intentionally narrow; unknown keys signal a wire-
          // shape mistake at the caller, not a feature the runner
          // silently drops.
          for (const k of Object.keys(obj)) {
            if (k !== "agent") {
              return err({
                cause: new WorkflowCoordSpecError(`Coord node spec rejects unknown key: ${k}`),
              });
            }
          }

          // Catalog existence — mirrors the sibling worker runner.
          // Checked at validate time so a bad agent name cannot land in
          // the DB and surface as a non-recoverable dispatch failure
          // later.
          let found: Awaited<ReturnType<typeof catalog.getAgent>>;
          try {
            found = await catalog.getAgent(obj.agent);
          } catch (cause) {
            return err({ cause: taskAgentUnresolvable(obj.agent, cause) });
          }
          if (found === null) return err({ cause: taskAgentNotFound(obj.agent) });

          // Workflow coordinator capability discipline: a workflow coord
          // MUST declare a non-empty `dependencies.agents` dispatch
          // menu in its catalog frontmatter. Without it, the coord has no
          // menu to validate worker spec.agent against, and the coord-vs-
          // task architectural split (workflow = declared menu; task =
          // open-ended) collapses.
          const menu = found.dependencies?.agents ?? [];
          if (menu.length === 0) {
            return err({ cause: new WorkflowCoordAgentNotCapableError(obj.agent) });
          }

          return ok({ agent: obj.agent });
        })(),
      );
    },

    dispatch(opts) {
      return new ResultAsync(
        (async (): Promise<Result<void, RunnerFault>> => {
          // Resolve the service exactly once per dispatch — see the
          // `getService` thunk JSDoc above. The substrate guarantees the
          // ref is assigned by the time dispatch fires (post-compose),
          // but the runner should fail loudly rather than silently
          // dereference if a caller wires the runner without ever
          // calling compose.
          const module = getModule?.() as WorkflowModule | null | undefined;
          if (module === null || module === undefined) {
            return err({
              cause: new Error(
                "workflow-coord-task-runner: getModule() returned null/undefined; " +
                  "compose-time wiring forgot to set the ref. " +
                  "Build the runner with a thunk that closes over the WorkflowModule " +
                  "returned by composeWorkflowModule.",
              ),
            });
          }

          const wfResult = await module.getWorkflow.execute({
            workflowId: opts.workflowId as WorkflowId,
          });
          if (wfResult.isErr()) return err({ cause: new Error(wfResult.error.type) });
          const wf = wfResult.value;
          const spec = opts.spec as WorkflowCoordinatorNodeSpec;
          const dispatchResult = await tasks.dispatchTask.execute({
            agent: spec.agent,
            brief: TaskBriefSchema.parse(wf.brief),
            // Conditional spread: passing `details: undefined` into
            // `tasks.dispatch` can serialize as the literal string
            // "undefined" downstream. Mirrors the worker runner's
            // conditional spread.
            ...(wf.details !== undefined ? { details: wf.details } : {}),
            origin: "workflow",
            originId: opts.nodeId,
            // `workflowId` stays in metadata for log correlation only.
            // Worker and coord runners write the node reverse-lookup id to
            // the SAME typed `origin_id` column — `hasInFlightByOrigin`
            // covers both kinds via the `tasks_origin_pair_idx` index.
            metadata: {
              workflowId: opts.workflowId,
            },
            // Override the default framing prompt for this dispatch only.
            // The constant is asserted safe by a unit test, and
            // `DispatchTaskUseCase` re-validates the forwarded prompt
            // before spawn.
            prompt: COORD_FRAMING_PROMPT_COPILOT,
            // Coord tasks see all three workflow env keys
            // (`GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`,
            // `GLYPH_WORKFLOW_DIR`). Worker tasks see only the first
            // two — see the sibling worker runner for the rationale
            // (the per-workflow shared dir is coord-only by design;
            // workers stay workflow-unaware). The convention is doc-
            // only, not OS-enforced. Key names are stable identifiers
            // referenced by `skills/workflow-coordination/SKILL.md`.
            subprocessEnv: {
              GLYPH_WORKFLOW_ID: opts.workflowId,
              GLYPH_NODE_ID: opts.nodeId,
              GLYPH_WORKFLOW_DIR: workflowDir(workspaceDir, opts.workflowId),
            },
          });
          if (dispatchResult.isErr()) return err({ cause: dispatchResult.error });
          const task = dispatchResult.value;
          const taskId = task.id;
          const nodeId = opts.nodeId;
          const onTerminal = opts.onTerminal;
          logger.info(
            { workflowId: opts.workflowId, nodeId, taskId },
            "workflow-coord-task-runner: dispatched coordinator task",
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
              let polled: GetTaskResponse;
              try {
                const getResult = await tasks.getTask.execute({ id: taskId as TaskId });
                if (getResult.isErr()) throw taskUseCaseError(getResult.error);
                polled = getResult.value;
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
                  "workflow-coord-task-runner: tasks.get threw",
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
              if (polled === null) {
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
              switch (polled.status) {
                case "running":
                  return;
                case "succeeded":
                  fireTerminal(
                    nodeId,
                    {
                      status: "succeeded",
                      output: polled.success ?? null,
                    },
                    onTerminal,
                  );
                  return;
                case "failed":
                  fireTerminal(
                    nodeId,
                    {
                      status: "failed",
                      reason: polled.failure?.message ?? "task failed (no reason recorded)",
                      output: polled.failure ?? null,
                    },
                    onTerminal,
                  );
                  return;
                case "cancelled":
                  fireTerminal(
                    nodeId,
                    {
                      status: "cancelled",
                      reason: polled.cancellation?.message ?? "task cancelled (no reason recorded)",
                    },
                    onTerminal,
                  );
                  return;
                default: {
                  // Defense against an unknown TaskStatus arm we don't
                  // know about. Treat as failure rather than silently
                  // dropping; the runner is the layer that owns the
                  // mapping and should fail loudly if it drifts.
                  const unexpected: never = polled.status;
                  fireTerminal(
                    nodeId,
                    {
                      status: "failed",
                      reason: `workflow-coord-task-runner: unexpected task status: ${unexpected as string}`,
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
              "workflow-coord-task-runner: listInFlightByOrigin threw during cancel",
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
                "workflow-coord-task-runner: tasks.cancel threw",
              );
            }
          }
          return ok(undefined);
        })(),
      );
    },

    listArtifacts() {
      return okAsync(null);
    },

    resolveArtifactPath() {
      return okAsync(null);
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
