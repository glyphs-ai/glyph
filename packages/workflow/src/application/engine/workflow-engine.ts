/** Event-driven workflow tick loop. */

import { eq } from "drizzle-orm";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import pino, { type Logger } from "pino";
import { WorkflowNodeEntity } from "../../domain/node/workflow-node-entity.js";
import { type WorkflowNodeId, WorkflowNodeIdSchema } from "../../domain/node/workflow-node-id.js";
import { COORDINATOR_KIND, WorkflowNodeKindSchema } from "../../domain/node/workflow-node-kind.js";
import {
  isTerminalWorkflowNodeStatus,
  WorkflowNodeStatusSchema,
} from "../../domain/node/workflow-node-status.js";
import { parentsReadyForKind } from "../../domain/workflow/workflow-dispatch-readiness.js";
import type { WorkflowId } from "../../domain/workflow/workflow-id.js";
import { WorkflowIdSchema } from "../../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowRepository,
} from "../../domain/workflow/workflow-repository.js";
import type { Db } from "../../infrastructure/drizzle/workflow-db.js";
import type { WorkflowQueries } from "../../infrastructure/drizzle/workflow-queries.js";
import type { WorkflowNodeRow } from "../../infrastructure/drizzle/workflow-schema.js";
import {
  runnerFor,
  type WorkflowNodeRunner,
  type WorkflowNodeTerminalResult,
  type WorkflowRunners,
} from "../ports/workflow-node-runner.js";

const silentLogger: Logger = pino({ level: "silent" });

export interface WorkflowDispatchCoordinator {
  triggerWorkflowTick(id: string): void;
  dispatch(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    opts?: { readonly onTerminal?: (r: WorkflowNodeTerminalResult) => void },
  ): ResultAsync<void, DatabaseUnavailable>;
  reconcileCancel(id: WorkflowId, opts: { readonly excludeRunningCoords: boolean }): Promise<void>;
}

export interface WorkflowEngineOpts {
  readonly repo: WorkflowRepository;
  readonly query: WorkflowQueries;
  readonly runners: WorkflowRunners;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
}

interface DispatchPayload {
  readonly runner: WorkflowNodeRunner;
  readonly workflowId: WorkflowId;
  readonly nodeId: WorkflowNodeId;
  readonly spec: unknown;
}

export class WorkflowEngine implements WorkflowDispatchCoordinator {
  private readonly repo: WorkflowRepository;
  private readonly query: WorkflowQueries;
  private readonly runners: WorkflowRunners;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly perWorkflowChain = new Map<string, Promise<void>>();
  private draining = false;

  constructor(opts: WorkflowEngineOpts) {
    this.repo = opts.repo;
    this.query = opts.query;
    this.runners = opts.runners;
    this.logger = opts.logger ?? silentLogger;
    this.now = opts.now ?? (() => new Date());
    void opts.randomUUID;
  }

  async drain(): Promise<void> {
    this.draining = true;
    await Promise.allSettled(Array.from(this.perWorkflowChain.values()));
  }

  triggerWorkflowTick(workflowId: string): void {
    if (this.draining) return;
    const prev = this.perWorkflowChain.get(workflowId) ?? Promise.resolve();
    const next = prev
      .then(() => this.tickOnce(workflowId))
      .catch((error) => {
        this.logger.warn({ workflowId, err: error }, "WorkflowEngine.tickOnce threw; swallowed");
      });
    this.perWorkflowChain.set(workflowId, next);
    void next.finally(() => {
      if (this.perWorkflowChain.get(workflowId) === next) this.perWorkflowChain.delete(workflowId);
    });
  }

  listEligibleNodeIdsForDispatch(
    workflowId: string,
  ): ResultAsync<readonly WorkflowNodeId[], DatabaseUnavailable> {
    return this.query.query((db) => this.listEligibleNodeIdsForDispatchSync(db, workflowId));
  }

  dispatch(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    opts: { readonly onTerminal?: (r: WorkflowNodeTerminalResult) => void } = {},
  ): ResultAsync<void, DatabaseUnavailable> {
    return new ResultAsync(this.dispatchImpl(workflowId, nodeId, opts));
  }

  markNodeTerminal(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    result: WorkflowNodeTerminalResult,
  ): ResultAsync<void, DatabaseUnavailable> {
    return new ResultAsync(this.markNodeTerminalImpl(workflowId, nodeId, result));
  }

  async reconcileCancel(
    workflowId: WorkflowId,
    opts: { readonly excludeRunningCoords: boolean },
  ): Promise<void> {
    const nodesResult = await this.query.query((db) =>
      db
        .select()
        .from(this.query.workflowNodes)
        .where(eq(this.query.workflowNodes.workflowId, workflowId))
        .all(),
    );
    if (nodesResult.isErr()) {
      this.logger.warn({ workflowId, err: nodesResult.error }, "reconcile: listing nodes failed");
      return;
    }
    const targets = nodesResult.value.filter((node) => {
      if (!isNonTerminal(node.status)) return false;
      return !(
        opts.excludeRunningCoords &&
        node.kind === COORDINATOR_KIND &&
        node.status === "running"
      );
    });
    for (const node of targets) {
      const parsedNodeId = WorkflowNodeIdSchema.safeParse(node.id);
      if (!parsedNodeId.success) continue;
      // Only running nodes have an in-flight unit-of-work to cancel; not_started
      // / ready nodes were never dispatched. runner.cancel failures are swallowed
      // (best-effort; the substrate marks the node cancelled regardless).
      if (node.status === "running")
        await runnerFor(this.runners, parseNodeKind(node.kind)).cancel(node.id);
      const workflow = await this.repo.get(workflowId);
      if (workflow.isErr()) {
        this.logger.warn(
          { workflowId, nodeId: node.id, err: workflow.error },
          "reconcile: get failed",
        );
        continue;
      }
      const terminal = workflow.value.markNodeTerminal(
        parsedNodeId.data,
        "cancelled",
        "workflow cancelled",
        this.now().toISOString(),
      );
      if (terminal.isErr()) {
        this.logger.warn(
          { workflowId, nodeId: node.id, err: terminal.error },
          "reconcile: mark failed",
        );
        continue;
      }
      const saved = await this.repo.save(workflow.value);
      if (saved.isErr())
        this.logger.warn(
          { workflowId, nodeId: node.id, err: saved.error },
          "reconcile: save failed",
        );
    }
  }

  private async tickOnce(workflowId: string): Promise<void> {
    if (this.draining) return;
    const eligibleResult = await this.listEligibleNodeIdsForDispatch(workflowId);
    if (eligibleResult.isErr()) {
      this.logger.warn({ workflowId, err: eligibleResult.error }, "tick: list eligible failed");
      return;
    }
    const parsedWorkflowId = WorkflowIdSchema.safeParse(workflowId);
    if (!parsedWorkflowId.success) return;
    await Promise.all(
      eligibleResult.value.map(async (nodeId) => {
        const dispatched = await this.dispatch(parsedWorkflowId.data, nodeId, {
          onTerminal: (result) => this.handleRunnerTerminal(parsedWorkflowId.data, nodeId, result),
        });
        if (dispatched.isErr())
          this.logger.error({ workflowId, nodeId, err: dispatched.error }, "tick: dispatch failed");
      }),
    );
  }

  private handleRunnerTerminal(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    result: WorkflowNodeTerminalResult,
  ): void {
    void this.markNodeTerminal(workflowId, nodeId, result).match(
      () => undefined,
      (error) => this.logger.error({ workflowId, nodeId, err: error }, "terminal mark failed"),
    );
  }

  private listEligibleNodeIdsForDispatchSync(
    db: Db,
    workflowId: string,
  ): readonly WorkflowNodeId[] {
    const parsedWorkflowId = WorkflowIdSchema.safeParse(workflowId);
    if (!parsedWorkflowId.success) return [];
    const workflow = db
      .select()
      .from(this.query.workflows)
      .where(eq(this.query.workflows.id, parsedWorkflowId.data))
      .get();
    if (workflow === undefined || workflow.status !== "running") return [];
    const nodeRows = db
      .select()
      .from(this.query.workflowNodes)
      .where(eq(this.query.workflowNodes.workflowId, parsedWorkflowId.data))
      .all();
    const edgeRows = db
      .select()
      .from(this.query.workflowEdges)
      .where(eq(this.query.workflowEdges.workflowId, parsedWorkflowId.data))
      .all();
    const nodes = nodeRows.map(toNodeEntity);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const eligible: WorkflowNodeId[] = [];
    for (const node of nodes) {
      if (node.status !== "not_started" && node.status !== "ready") continue;
      const parentIds = edgeRows
        .filter((edge) => edge.toNodeId === node.id)
        .map((edge) => edge.fromNodeId);
      const parents = parentIds.flatMap((id) => {
        const parsed = WorkflowNodeIdSchema.safeParse(id);
        if (!parsed.success) return [];
        const parent = byId.get(parsed.data);
        return parent === undefined ? [] : [parent];
      });
      if (parentsReadyForKind(node.kind, parents)) eligible.push(node.id);
    }
    return eligible;
  }

  private async dispatchImpl(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    opts: { readonly onTerminal?: (r: WorkflowNodeTerminalResult) => void },
  ): Promise<Result<void, DatabaseUnavailable>> {
    const workflow = await this.repo.get(workflowId);
    if (workflow.isErr()) return this.ignoreNonDatabase(workflow.error, { workflowId, nodeId });
    const node = workflow.value.nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) return ok(undefined);
    const running = workflow.value.markNodeRunning(nodeId, this.now().toISOString());
    if (running.isErr()) return ok(undefined);
    const saved = await this.repo.save(workflow.value);
    if (saved.isErr()) return err(saved.error);
    const payload: DispatchPayload = {
      runner: runnerFor(this.runners, node.kind),
      workflowId,
      nodeId,
      spec: node.spec,
    };
    const onTerminal =
      opts.onTerminal ?? ((result) => this.handleRunnerTerminal(workflowId, nodeId, result));
    const dispatched = await payload.runner.dispatch({
      workflowId: payload.workflowId,
      nodeId: payload.nodeId,
      spec: payload.spec,
      onTerminal,
    });
    if (dispatched.isErr()) {
      const cause = dispatched.error.cause;
      const reason = `runner.dispatch failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      const marked = await this.markNodeTerminal(workflowId, nodeId, { status: "failed", reason });
      if (marked.isErr())
        this.logger.error(
          { workflowId, nodeId, err: marked.error },
          "dispatch failure mark failed",
        );
    }
    return ok(undefined);
  }

  private async markNodeTerminalImpl(
    workflowId: WorkflowId,
    nodeId: WorkflowNodeId,
    result: WorkflowNodeTerminalResult,
  ): Promise<Result<void, DatabaseUnavailable>> {
    const workflow = await this.repo.get(workflowId);
    if (workflow.isErr()) return this.ignoreNonDatabase(workflow.error, { workflowId, nodeId });
    const terminal = workflow.value.markNodeTerminal(
      nodeId,
      result.status,
      "reason" in result ? result.reason : undefined,
      this.now().toISOString(),
    );
    if (terminal.isErr()) {
      this.logger.warn({ workflowId, nodeId, err: terminal.error }, "mark terminal ignored");
      return ok(undefined);
    }
    const saved = await this.repo.save(workflow.value);
    if (saved.isErr()) return err(saved.error);
    if (terminal.value.retryCoordInserted !== null) {
      const dispatched = await this.dispatch(workflowId, terminal.value.retryCoordInserted);
      if (dispatched.isErr()) return err(dispatched.error);
    }
    this.triggerWorkflowTick(workflowId);
    return ok(undefined);
  }

  private ignoreNonDatabase(
    error: DatabaseUnavailable | WorkflowEntityCorruption | { readonly type: string },
    context: { readonly workflowId: string; readonly nodeId: string },
  ): Result<void, DatabaseUnavailable> {
    if (isDatabaseUnavailable(error)) return err(error);
    this.logger.warn({ ...context, err: error }, "engine aggregate read failed; ignored");
    return ok(undefined);
  }
}

function isDatabaseUnavailable(error: { readonly type: string }): error is DatabaseUnavailable {
  return error.type === "DatabaseUnavailable";
}

function isNonTerminal(status: string): boolean {
  return !isTerminalWorkflowNodeStatus(parseNodeStatus(status));
}

function parseNodeKind(raw: string) {
  const parsed = WorkflowNodeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : "worker";
}

function parseNodeStatus(raw: string) {
  const parsed = WorkflowNodeStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "not_started";
}

function toNodeEntity(row: WorkflowNodeRow): WorkflowNodeEntity {
  return WorkflowNodeEntity.reconstitute({
    id: WorkflowNodeIdSchema.parse(row.id),
    workflowId: WorkflowIdSchema.parse(row.workflowId),
    kind: WorkflowNodeKindSchema.parse(row.kind),
    spec: parseJson(row.specJson),
    phase: row.phase,
    status: WorkflowNodeStatusSchema.parse(row.status),
    metadata: parseJsonObject(row.metadata),
    createdAt: row.createdAt,
    readyAt: row.readyAt ?? undefined,
    runningAt: row.runningAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  });
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJson(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}
