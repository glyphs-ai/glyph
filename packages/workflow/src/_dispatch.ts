import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Logger } from "pino";
import {
  COORDINATOR_KIND,
  HUMAN_KIND,
  parentsOf,
  parentsReadyForKind,
  WORKER_KIND,
} from "./_dag.js";
import { WorkflowNodeKindCorruptionError } from "./errors.js";
import { workflowNodeDir } from "./paths.js";
import type * as schema from "./schema.js";
import type {
  DispatchAtomicOpts,
  WorkflowNodeRunner,
  WorkflowNodeTerminalResult,
  WorkflowRunners,
} from "./types.js";
import type { WorkflowNodeEntity } from "./workflow-entity.js";
import type { WorkflowRepository } from "./workflow-repository.js";

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Capability bundle the free dispatch helpers close over. {@link
 * WorkflowService} builds one of these in its constructor and threads
 * it into every helper, so the per-kind dispatch indirection can live
 * outside the class without losing access to the repo / db / runner
 * registry. `markNodeTerminal` is supplied as a bound callback because
 * the terminal-write path stays on the service (it drives stuck-
 * recovery + the post-commit engine nudge); the dispatch helpers only
 * need to be able to fire it.
 */
export interface DispatchCtx {
  readonly db: Db;
  readonly repo: WorkflowRepository;
  readonly runners: WorkflowRunners;
  readonly workspaceDir: string;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly markNodeTerminal: (
    workflowId: string,
    nodeId: string,
    result: WorkflowNodeTerminalResult,
  ) => Promise<void>;
}

/**
 * Resolve the runner for a `WorkflowNodeKind`. Caller-supplied `kind`
 * values are TypeScript-checked against the closed enum, so the
 * `default` branch only fires for persisted-row corruption; it
 * throws {@link WorkflowNodeKindCorruptionError} for diagnosis.
 */
export function runnerFor(runners: WorkflowRunners, kind: string): WorkflowNodeRunner {
  switch (kind) {
    case COORDINATOR_KIND:
      return runners.coordinator;
    case WORKER_KIND:
      return runners.worker;
    case HUMAN_KIND:
      return runners.human;
    default:
      throw new WorkflowNodeKindCorruptionError(kind);
  }
}

/**
 * Engine-facing read primitive: enumerate the node ids in
 * `workflowId` that are currently eligible for dispatch — i.e.
 * status is `not_started` or `ready` AND per-kind parent readiness
 * is satisfied (or the node has no parents).
 *
 * Returns node ids only (the engine re-reads each node fresh inside
 * `dispatchAtomic` anyway). Computed inside a single read tx for a
 * consistent snapshot. The engine treats the returned list as a
 * best-effort hint: `dispatchAtomic` re-checks each gate inside
 * its own write tx, so a node that becomes ineligible between this
 * read and the dispatch tx is silently no-op'd.
 */
export async function listEligibleNodeIdsForDispatch(
  ctx: DispatchCtx,
  workflowId: string,
): Promise<readonly string[]> {
  return ctx.db.transaction((tx) => {
    const wf = ctx.repo.readWorkflowTx(tx, workflowId);
    if (wf === null || wf.status !== "running") return [] as readonly string[];
    const nodes = ctx.repo.listNodesByWorkflowTx(tx, workflowId);
    const edges = ctx.repo.listEdgesByWorkflowTx(tx, workflowId);
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const eligible: string[] = [];
    for (const node of nodes) {
      if (node.status !== "not_started" && node.status !== "ready") continue;
      const parentIds = parentsOf(node.id, edges);
      const parents = parentIds
        .map((pid) => byId.get(pid))
        .filter((p): p is WorkflowNodeEntity => p !== undefined);
      if (parents.length !== parentIds.length) continue;
      if (parents.length > 0 && !parentsReadyForKind(node.kind, parents)) continue;
      eligible.push(node.id);
    }
    return eligible;
  });
}

/**
 * Substrate primitive: flip a node from `not_started|ready` →
 * `running` and invoke its per-kind runner's `dispatch` AFTER
 * the tx commits. On dispatch throw, a separate tx writes
 * `status='failed'`.
 *
 * Inside the tx:
 *   - re-reads `workflow.status` (defends against cancel race)
 *   - re-reads `node.status` (defends against parallel dispatch)
 *   - re-checks per-kind parent readiness (defends against
 *     parent-cancel race between the eager-dispatch reaction and
 *     this call)
 *
 * If any check fails, the tx is a no-op and the call returns
 * silently — the substrate's invariant is "calling dispatchAtomic
 * is always safe; it does nothing when the node is not eligible".
 *
 * The runner invocation is OUTSIDE the tx because holding a
 * write lock across an async network call would serialize the
 * entire workflow engine on a slow dispatch.
 *
 * `opts.onTerminal` is threaded into the runner's `dispatch` opts
 * so the runner can push terminal results back to the substrate
 * (where it's handled by `markNodeTerminal`) without knowing about
 * service plumbing. When omitted, the substrate substitutes a
 * default callback that delegates to `ctx.markNodeTerminal`
 * directly. Either path lands the same idempotent state write —
 * `markNodeTerminal` is the single source of truth for the
 * substrate's terminal write.
 */
export async function dispatchAtomic(
  ctx: DispatchCtx,
  nodeId: string,
  opts: DispatchAtomicOpts = {},
): Promise<void> {
  let dispatchPayload: {
    readonly runner: WorkflowNodeRunner;
    readonly workflowId: string;
    readonly nodeId: string;
    readonly spec: unknown;
    readonly nodeDir: string;
  } | null = null;

  ctx.db.transaction((tx) => {
    const node = ctx.repo.readNodeTx(tx, nodeId);
    if (node === null) return;
    if (node.status !== "not_started" && node.status !== "ready") return;
    const wf = ctx.repo.readWorkflowTx(tx, node.workflowId);
    if (wf === null || wf.status !== "running") return;

    const runner = runnerFor(ctx.runners, node.kind);

    // Per-kind parent readiness re-check inside the tx.
    const allEdges = ctx.repo.listEdgesByWorkflowTx(tx, node.workflowId);
    const parentIds = parentsOf(node.id, allEdges);
    const parents = ctx.repo.readNodesByIds(tx, parentIds);
    if (parentIds.length !== parents.length) return;
    if (parents.length > 0 && !parentsReadyForKind(node.kind, parents)) return;

    const nowIso = ctx.now().toISOString();
    ctx.repo.updateNodeLifecycle(tx, {
      id: nodeId,
      status: "running",
      runningAt: nowIso,
    });

    dispatchPayload = {
      runner,
      workflowId: node.workflowId,
      nodeId,
      spec: node.spec,
      nodeDir: workflowNodeDir(ctx.workspaceDir, node.workflowId, nodeId),
    };
  });

  if (dispatchPayload === null) return;
  const payload = dispatchPayload as {
    readonly runner: WorkflowNodeRunner;
    readonly workflowId: string;
    readonly nodeId: string;
    readonly spec: unknown;
    readonly nodeDir: string;
  };

  // Resolve the `onTerminal` callback. Callers that don't supply
  // one get a default that drives `markNodeTerminal` so the
  // substrate's terminal-write path stays single-source-of-truth.
  const effectiveOnTerminal: (result: WorkflowNodeTerminalResult) => void =
    opts.onTerminal ??
    ((result) => {
      // Fire-and-forget into `markNodeTerminal`, with a `.catch`
      // so a throw from the terminal-write tx surfaces as a logged
      // error instead of an unhandled promise rejection.
      void ctx.markNodeTerminal(payload.workflowId, payload.nodeId, result).catch((err) => {
        ctx.logger.error(
          { workflowId: payload.workflowId, nodeId: payload.nodeId, err },
          "dispatchAtomic: default onTerminal markNodeTerminal threw",
        );
      });
    });

  try {
    await payload.runner.dispatch({
      workflowId: payload.workflowId,
      nodeId: payload.nodeId,
      spec: payload.spec,
      nodeDir: payload.nodeDir,
      onTerminal: effectiveOnTerminal,
    });
  } catch (err) {
    ctx.logger.warn({ nodeId, err }, "dispatchAtomic: runner.dispatch threw; marking node failed");
    const reason = `runner.dispatch threw: ${err instanceof Error ? err.message : String(err)}`;
    try {
      await ctx.markNodeTerminal(payload.workflowId, payload.nodeId, {
        status: "failed",
        reason,
      });
    } catch (writeErr) {
      ctx.logger.error(
        { nodeId, err: writeErr },
        "dispatchAtomic: failed to write failed status after dispatch error",
      );
    }
  }
}
