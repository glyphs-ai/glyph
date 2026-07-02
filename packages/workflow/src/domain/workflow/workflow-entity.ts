import { err, ok, type Result } from "neverthrow";
import { WorkflowEdgeEntity } from "../edge/workflow-edge-entity.js";
import { WorkflowNodeEntity } from "../node/workflow-node-entity.js";
import { generateWorkflowNodeId, type WorkflowNodeId } from "../node/workflow-node-id.js";
import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";
import { COORDINATOR_KIND, HUMAN_KIND, WORKER_KIND } from "../node/workflow-node-kind.js";
import type { WorkflowNodeRetryMetadata } from "../node/workflow-node-retry.js";
import { extractWorkflowNodeRetryMetadata } from "../node/workflow-node-retry.js";
import {
  isTerminalWorkflowNodeStatus,
  type TerminalWorkflowNodeStatus,
  type WorkflowNodeStatus,
} from "../node/workflow-node-status.js";
import type { WorkflowId } from "../workflow/workflow-id.js";
import type { WorkflowCancellation } from "./workflow-cancellation.js";
import { computePhaseFromParents, structuralLeaves, wouldCreateCycle } from "./workflow-dag.js";
import { parentsReadyForKind } from "./workflow-dispatch-readiness.js";
import type {
  DagInvariant,
  EdgeCycle,
  EmptyParents,
  MultipleSuccessorCoords,
  OrphanCoordInsert,
  ParentState,
  RemoveEdgeOrphansChild,
  RemoveNodeOrphansChild,
  SubgraphError,
  WorkflowNodeNotMutable,
} from "./workflow-errors.js";
import { workflowNodeNotMutable } from "./workflow-errors.js";
import type { WorkflowFailure } from "./workflow-failure.js";
import type { WorkflowOrigin } from "./workflow-origin.js";
import type { WorkflowEdgeNotFound, WorkflowNodeNotFound } from "./workflow-repository.js";
import type { WorkflowStatus } from "./workflow-status.js";
import {
  classifyStuckReason,
  STUCK_RETRY_LIMIT,
  STUCK_RETRY_MAX_ATTEMPTS,
} from "./workflow-stuck-recovery.js";
import type { WorkflowSuccess } from "./workflow-success.js";

export interface WorkflowCreateArgs {
  readonly id: WorkflowId;
  readonly brief: string;
  readonly details?: string;
  readonly coordinatorAgent: string;
  readonly origin?: WorkflowOrigin;
  readonly originId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}
export interface WorkflowReconstituteArgs {
  readonly id: WorkflowId;
  readonly brief: string;
  readonly details: string | undefined;
  readonly coordinatorAgent: string;
  readonly status: WorkflowStatus;
  readonly origin: WorkflowOrigin;
  readonly originId: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly success: WorkflowSuccess | undefined;
  readonly failure: WorkflowFailure | undefined;
  readonly cancellation: WorkflowCancellation | undefined;
  readonly nodes: readonly WorkflowNodeEntity[];
  readonly edges: readonly WorkflowEdgeEntity[];
}
export type WorkflowAlreadyTerminal = {
  readonly type: "WorkflowAlreadyTerminal";
  readonly workflowId: string;
  readonly status: WorkflowStatus;
};
export type WorkflowDeleteRequiresTerminal = {
  readonly type: "WorkflowDeleteRequiresTerminal";
  readonly workflowId: string;
  readonly status: WorkflowStatus;
};
export type IllegalNodeTransition = {
  readonly type: "IllegalNodeTransition";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly status: string;
  readonly verb: string;
};
export type NodeRef =
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "temp"; readonly tempId: string };
export interface SubgraphTempNodeShape {
  readonly tempId: string;
  readonly kind: WorkflowNodeKind;
  readonly existingParents: readonly string[];
}
export interface SubgraphNodeInput extends SubgraphTempNodeShape {
  readonly validatedSpec: unknown;
}
export interface SubgraphEdgeShape {
  readonly from: NodeRef;
  readonly to: NodeRef;
}
export interface NormalizedSubgraphInput {
  readonly nodes: readonly SubgraphTempNodeShape[];
  readonly edges: readonly SubgraphEdgeShape[];
}
export interface WorkflowNodeSnapshot {
  readonly status: WorkflowNodeStatus;
  readonly phase: number;
  readonly spec: unknown;
  readonly readyAt: string | undefined;
  readonly runningAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface WorkflowHeaderSnapshot {
  readonly brief: string;
  readonly details: string | undefined;
  readonly coordinatorAgent: string;
  readonly status: WorkflowStatus;
  readonly origin: WorkflowOrigin;
  readonly originId: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly success: WorkflowSuccess | undefined;
  readonly failure: WorkflowFailure | undefined;
  readonly cancellation: WorkflowCancellation | undefined;
}
export interface WorkflowSnapshot {
  readonly header: WorkflowHeaderSnapshot | null;
  readonly nodes: ReadonlyMap<WorkflowNodeId, WorkflowNodeSnapshot>;
  readonly edgeKeys: ReadonlySet<string>;
}

export class WorkflowEntity {
  private _id: WorkflowId;
  private _brief: string;
  private _details: string | undefined;
  private _coordinatorAgent: string;
  private _status: WorkflowStatus;
  private _origin: WorkflowOrigin;
  private _originId: string | undefined;
  private _metadata: Readonly<Record<string, unknown>>;
  private _createdAt: string;
  private _startedAt: string | undefined;
  private _endedAt: string | undefined;
  private _success: WorkflowSuccess | undefined;
  private _failure: WorkflowFailure | undefined;
  private _cancellation: WorkflowCancellation | undefined;
  private _nodes: WorkflowNodeEntity[];
  private _edges: WorkflowEdgeEntity[];
  private readonly snapshot: WorkflowSnapshot;
  private deleted = false;
  private constructor(args: WorkflowReconstituteArgs, snapshot: WorkflowSnapshot) {
    this._id = args.id;
    this._brief = args.brief;
    this._details = args.details;
    this._coordinatorAgent = args.coordinatorAgent;
    this._status = args.status;
    this._origin = args.origin;
    this._originId = args.originId;
    this._metadata = Object.freeze({ ...args.metadata });
    this._createdAt = args.createdAt;
    this._startedAt = args.startedAt;
    this._endedAt = args.endedAt;
    this._success = args.success;
    this._failure = args.failure;
    this._cancellation = args.cancellation;
    this._nodes = [...args.nodes];
    this._edges = [...args.edges];
    this.snapshot = snapshot;
  }
  static create(args: WorkflowCreateArgs): WorkflowEntity {
    return new WorkflowEntity(
      {
        id: args.id,
        brief: args.brief,
        details: args.details,
        coordinatorAgent: args.coordinatorAgent,
        status: "running",
        origin: args.origin ?? "standalone",
        originId: args.originId,
        metadata: args.metadata ?? {},
        createdAt: args.createdAt,
        startedAt: args.createdAt,
        endedAt: undefined,
        success: undefined,
        failure: undefined,
        cancellation: undefined,
        nodes: [],
        edges: [],
      },
      emptySnapshot(),
    );
  }
  static reconstitute(args: WorkflowReconstituteArgs): WorkflowEntity {
    return new WorkflowEntity(args, captureSnapshot(args));
  }
  succeed(success: WorkflowSuccess, nowIso: string): Result<void, WorkflowAlreadyTerminal> {
    return this.toTerminal("succeeded", nowIso, { success });
  }
  fail(failure: WorkflowFailure, nowIso: string): Result<void, WorkflowAlreadyTerminal> {
    return this.toTerminal("failed", nowIso, { failure });
  }
  cancel(
    cancellation: WorkflowCancellation,
    nowIso: string,
  ): Result<void, WorkflowAlreadyTerminal> {
    return this.toTerminal("cancelled", nowIso, { cancellation });
  }
  markDeleted(): Result<void, WorkflowDeleteRequiresTerminal> {
    if (this.status === "running")
      return err({
        type: "WorkflowDeleteRequiresTerminal",
        workflowId: this.id,
        status: this.status,
      });
    this.deleted = true;
    return ok(undefined);
  }
  addNode(args: {
    readonly nodeId: WorkflowNodeId;
    readonly kind: WorkflowNodeKind;
    readonly validatedSpec: unknown;
    readonly parents: readonly WorkflowNodeId[];
    readonly nowIso: string;
  }): Result<
    { readonly nodeId: WorkflowNodeId; readonly phase: number },
    | WorkflowAlreadyTerminal
    | EmptyParents
    | ParentState
    | OrphanCoordInsert
    | MultipleSuccessorCoords
    | WorkflowNodeNotFound
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const parents = uniqueNodeIds(args.parents);
    if (args.kind !== COORDINATOR_KIND && parents.length === 0)
      return err({ type: "EmptyParents" });
    const parentEntities = this.parentEntities(parents);
    if (parentEntities.isErr()) return err(parentEntities.error);
    const parentState = this.rejectBadParentsForKind(args.kind, parentEntities.value);
    if (parentState.isErr()) return err(parentState.error);
    if (args.kind === COORDINATOR_KIND) {
      const coordInvariant = this.enforceCoordChainInvariants(parentEntities.value);
      if (coordInvariant.isErr()) return err(coordInvariant.error);
    }
    const phase = computePhaseFromParents(parentEntities.value);
    const node = WorkflowNodeEntity.create({
      id: args.nodeId,
      workflowId: this.id,
      kind: args.kind,
      spec: args.validatedSpec,
      phase,
      status: "not_started",
      createdAt: args.nowIso,
    });
    const insertedEdges = parents.map((parent) => ({ from: parent, to: args.nodeId }));
    this._nodes.push(node);
    this._edges.push(
      ...insertedEdges.map((edge) => WorkflowEdgeEntity.create({ workflowId: this.id, ...edge })),
    );
    if (args.kind === COORDINATOR_KIND) this.patchCoordinatorAgent(args.validatedSpec);
    this.applyPhaseUpdates(this.recomputePhases([args.nodeId], [node], insertedEdges));
    return ok({ nodeId: args.nodeId, phase });
  }
  addEdge(
    from: WorkflowNodeId,
    to: WorkflowNodeId,
  ): Result<
    void,
    | WorkflowAlreadyTerminal
    | EdgeCycle
    | ParentState
    | WorkflowNodeNotFound
    | WorkflowNodeNotMutable
    | MultipleSuccessorCoords
    | OrphanCoordInsert
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const fromNode = this.nodeById(from);
    if (fromNode === undefined || fromNode.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId: from });
    const toNode = this.nodeById(to);
    if (toNode === undefined || toNode.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId: to });
    if (toNode.status !== "not_started")
      return err(workflowNodeNotMutable(this.id, to, toNode.status, "addEdge"));
    const parentState = this.rejectBadParentsForKind(toNode.kind, [fromNode]);
    if (parentState.isErr()) return err(parentState.error);
    if (toNode.kind === COORDINATOR_KIND) {
      const currentParents = this.parents(to)
        .map((id) => this.nodeById(id))
        .filter(isNode);
      const coordInvariant = this.enforceCoordChainInvariants([...currentParents, fromNode]);
      if (coordInvariant.isErr()) return err(coordInvariant.error);
    }
    if (this.wouldCreateCycle({ from, to }))
      return err({ type: "EdgeCycle", workflowId: this.id, from, to });
    this._edges.push(WorkflowEdgeEntity.create({ workflowId: this.id, from, to }));
    this.applyPhaseUpdates(this.recomputePhases([to], [], [{ from, to }]));
    return ok(undefined);
  }

  addSubgraph(args: {
    readonly nodes: readonly SubgraphNodeInput[];
    readonly edges: readonly SubgraphEdgeShape[];
    readonly mintId: (tempId: string) => WorkflowNodeId;
    readonly nowIso: string;
  }): Result<
    {
      readonly insertedNodes: readonly {
        readonly tempId: string;
        readonly nodeId: WorkflowNodeId;
        readonly phase: number;
      }[];
    },
    | WorkflowAlreadyTerminal
    | SubgraphError
    | DagInvariant
    | ParentState
    | OrphanCoordInsert
    | MultipleSuccessorCoords
    | WorkflowNodeNotFound
    | WorkflowNodeNotMutable
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const normalized = normalizeSubgraphInput({ nodes: args.nodes, edges: args.edges });
    const shape = validateSubgraphShape(this.id, normalized.nodes, normalized.edges);
    if (shape.isErr()) return err(shape.error);
    const topo = resolveSubgraphTopology(this.id, normalized.nodes, normalized.edges);
    if (topo.isErr()) return err(topo.error);
    const inputByTemp = new Map(args.nodes.map((node) => [node.tempId, node]));
    const tempIdToNodeId = new Map<string, WorkflowNodeId>();
    for (const node of topo.value) tempIdToNodeId.set(node.tempId, args.mintId(node.tempId));
    const existingIds = collectExistingIds(normalized.nodes, normalized.edges);
    const existing = this.parentEntities(existingIds);
    if (existing.isErr()) return err(existing.error);
    const existingById = new Map(existing.value.map((node) => [node.id, node]));
    for (const edge of normalized.edges)
      if (edge.to.kind === "existing") {
        const target = existingById.get(edge.to.id as WorkflowNodeId);
        if (target !== undefined && target.status !== "not_started")
          return err(workflowNodeNotMutable(this.id, edge.to.id, target.status, "addSubgraph"));
      }
    for (const node of normalized.nodes) {
      const parents = node.existingParents
        .map((id) => existingById.get(id as WorkflowNodeId))
        .filter(isNode);
      const parentState = this.rejectBadParentsForKind(node.kind, parents);
      if (parentState.isErr()) return err(parentState.error);
    }
    const allNewEdges = buildNewEdges(normalized.nodes, normalized.edges, tempIdToNodeId);
    const simulatedEdges = this.edges.map((edge) => ({ from: edge.from, to: edge.to }));
    for (const edge of allNewEdges) {
      if (wouldCreateCycle(simulatedEdges, edge))
        return err({
          type: "WorkflowSubgraphCyclic",
          workflowId: this.id,
          from: edge.from,
          to: edge.to,
        });
      simulatedEdges.push(edge);
    }
    const phaseByTemp = new Map<string, number>();
    const insertedNodes: WorkflowNodeEntity[] = [];
    const insertedResponse: { tempId: string; nodeId: WorkflowNodeId; phase: number }[] = [];
    for (const node of topo.value) {
      const full = inputByTemp.get(node.tempId);
      if (full === undefined)
        return err({
          type: "WorkflowSubgraphNodeRefUnresolved",
          workflowId: this.id,
          refKind: "temp",
          refValue: node.tempId,
        });
      const parentIds = parentIdsForTemp(
        node.tempId,
        normalized.nodes,
        normalized.edges,
        tempIdToNodeId,
      );
      const parentEntities = parentIds.map((id) => existingById.get(id)).filter(isNode);
      let phase = computePhaseFromParents(parentEntities);
      for (const edge of normalized.edges)
        if (edge.to.kind === "temp" && edge.to.tempId === node.tempId && edge.from.kind === "temp")
          phase = Math.max(phase, (phaseByTemp.get(edge.from.tempId) ?? -1) + 1);
      phaseByTemp.set(node.tempId, phase);
      const nodeId = tempIdToNodeId.get(node.tempId) as WorkflowNodeId;
      const inserted = WorkflowNodeEntity.create({
        id: nodeId,
        workflowId: this.id,
        kind: node.kind,
        spec: full.validatedSpec,
        phase,
        status: "not_started",
        createdAt: args.nowIso,
      });
      insertedNodes.push(inserted);
      insertedResponse.push({ tempId: node.tempId, nodeId, phase });
    }
    const coordNode = normalized.nodes.find((node) => node.kind === COORDINATOR_KIND);
    if (coordNode !== undefined) {
      const coordParents = parentIdsForTemp(
        coordNode.tempId,
        normalized.nodes,
        normalized.edges,
        tempIdToNodeId,
      );
      const byId = new Map([...this.nodes, ...insertedNodes].map((node) => [node.id, node]));
      const parents = coordParents.map((id) => byId.get(id)).filter(isNode);
      const coordInvariant = this.enforceCoordChainInvariants(parents);
      if (coordInvariant.isErr()) return err(coordInvariant.error);
    }
    const startNodeIds = normalized.edges.flatMap((edge) =>
      edge.to.kind === "existing" ? [edge.to.id as WorkflowNodeId] : [],
    );
    const phaseUpdates = this.recomputePhases(startNodeIds, insertedNodes, allNewEdges);
    const finalLeaves = structuralLeaves([...this.nodes, ...insertedNodes], simulatedEdges);
    if (!(finalLeaves.length === 1 && finalLeaves[0]?.kind === COORDINATOR_KIND))
      return err({
        type: "DagInvariant",
        workflowId: this.id,
        actualLeafIds: finalLeaves.map((node) => node.id),
        actualLeafKinds: finalLeaves.map((node) => node.kind),
      });
    this._nodes.push(...insertedNodes);
    this._edges.push(
      ...allNewEdges.map((edge) => WorkflowEdgeEntity.create({ workflowId: this.id, ...edge })),
    );
    this.applyPhaseUpdates(phaseUpdates);
    if (coordNode !== undefined)
      this.patchCoordinatorAgent(inputByTemp.get(coordNode.tempId)?.validatedSpec);
    return ok({ insertedNodes: insertedResponse });
  }
  removeNode(
    nodeId: WorkflowNodeId,
  ): Result<
    void,
    WorkflowAlreadyTerminal | WorkflowNodeNotFound | WorkflowNodeNotMutable | RemoveNodeOrphansChild
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const node = this.nodeById(nodeId);
    if (node === undefined || node.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId });
    if (node.status !== "not_started")
      return err(workflowNodeNotMutable(this.id, nodeId, node.status, "removeNode"));
    const childIds = this.children(nodeId);
    for (const child of childIds)
      if (this.parents(child).filter((parent) => parent !== nodeId).length === 0)
        return err({
          type: "RemoveNodeOrphansChild",
          workflowId: this.id,
          nodeId,
          orphanedChildId: child,
        });
    const phaseUpdates = this.recomputePhases(childIds, [], [], [nodeId]);
    this._nodes = this._nodes.filter((candidate) => candidate.id !== nodeId);
    this._edges = this._edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
    this.applyPhaseUpdates(phaseUpdates);
    return ok(undefined);
  }
  removeEdge(
    from: WorkflowNodeId,
    to: WorkflowNodeId,
  ): Result<
    void,
    | WorkflowAlreadyTerminal
    | WorkflowNodeNotFound
    | WorkflowNodeNotMutable
    | WorkflowEdgeNotFound
    | RemoveEdgeOrphansChild
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const fromNode = this.nodeById(from);
    if (fromNode === undefined || fromNode.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId: from });
    const toNode = this.nodeById(to);
    if (toNode === undefined || toNode.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId: to });
    // The to-node's parent set is part of its lineage; re-parenting a node that
    // has already left `not_started` would retroactively change an in-flight or
    // finished node's phase, so edge removal is refused once it is mutable.
    if (toNode.status !== "not_started")
      return err(workflowNodeNotMutable(this.id, to, toNode.status, "removeEdge"));
    if (!this.edges.some((edge) => edge.from === from && edge.to === to))
      return err({
        type: "WorkflowEdgeNotFound",
        workflowId: this.id,
        fromNodeId: from,
        toNodeId: to,
      });
    if (this.parents(to).length <= 1)
      return err({
        type: "RemoveEdgeOrphansChild",
        workflowId: this.id,
        fromNodeId: from,
        toNodeId: to,
      });
    const phaseUpdates = this.recomputePhases([to], [], [], [], [{ from, to }]);
    this._edges = this._edges.filter((edge) => !(edge.from === from && edge.to === to));
    this.applyPhaseUpdates(phaseUpdates);
    return ok(undefined);
  }
  replaceNodeSpec(
    nodeId: WorkflowNodeId,
    validatedSpec: unknown,
  ): Result<void, WorkflowAlreadyTerminal | WorkflowNodeNotFound | WorkflowNodeNotMutable> {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const node = this.nodeById(nodeId);
    if (node === undefined || node.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId });
    if (node.status !== "not_started")
      return err(workflowNodeNotMutable(this.id, nodeId, node.status, "replaceSpec"));
    this.replaceNode(node.withPatch({ spec: validatedSpec }));
    if (node.kind === COORDINATOR_KIND && this.latestCoordId() === nodeId)
      this.patchCoordinatorAgent(validatedSpec);
    return ok(undefined);
  }
  replaceNodeMetadata(
    nodeId: WorkflowNodeId,
    metadata: Readonly<Record<string, unknown>>,
  ): Result<void, WorkflowNodeNotFound> {
    const node = this.nodeById(nodeId);
    if (node === undefined || node.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId });
    this.replaceNode(node.withPatch({ metadata }));
    return ok(undefined);
  }
  addRetryCoordNode(args: {
    readonly nodeId: WorkflowNodeId;
    readonly parentIds: readonly WorkflowNodeId[];
    readonly agent: string;
    readonly retry: WorkflowNodeRetryMetadata;
    readonly nowIso: string;
  }): Result<
    { readonly nodeId: WorkflowNodeId; readonly phase: number },
    WorkflowAlreadyTerminal | WorkflowNodeNotFound | OrphanCoordInsert | MultipleSuccessorCoords
  > {
    const running = this.requireRunning();
    if (running.isErr()) return err(running.error);
    const parentIds = uniqueNodeIds(args.parentIds);
    const parentEntities = this.parentEntities(parentIds);
    if (parentEntities.isErr()) return err(parentEntities.error);
    const coordInvariant = this.enforceCoordChainInvariants(parentEntities.value);
    if (coordInvariant.isErr()) return err(coordInvariant.error);
    const phase = computePhaseFromParents(parentEntities.value);
    const node = WorkflowNodeEntity.create({
      id: args.nodeId,
      workflowId: this.id,
      kind: COORDINATOR_KIND,
      spec: { agent: args.agent },
      phase,
      status: "not_started",
      metadata: { retry: args.retry },
      createdAt: args.nowIso,
    });
    const insertedEdges = parentIds.map((parent) => ({ from: parent, to: args.nodeId }));
    this._nodes.push(node);
    this._edges.push(
      ...insertedEdges.map((edge) => WorkflowEdgeEntity.create({ workflowId: this.id, ...edge })),
    );
    this._coordinatorAgent = args.agent;
    this.applyPhaseUpdates(this.recomputePhases([args.nodeId], [node], insertedEdges));
    return ok({ nodeId: args.nodeId, phase });
  }
  markNodeRunning(
    nodeId: WorkflowNodeId,
    nowIso: string,
  ): Result<void, WorkflowNodeNotFound | IllegalNodeTransition> {
    const node = this.nodeById(nodeId);
    if (node === undefined || node.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId });
    if (this.status !== "running" || (node.status !== "not_started" && node.status !== "ready"))
      return err({
        type: "IllegalNodeTransition",
        workflowId: this.id,
        nodeId,
        status: node.status,
        verb: "markNodeRunning",
      });
    const parents = this.parents(nodeId)
      .map((id) => this.nodeById(id))
      .filter(isNode);
    if (!parentsReadyForKind(node.kind, parents))
      return err({
        type: "IllegalNodeTransition",
        workflowId: this.id,
        nodeId,
        status: node.status,
        verb: "markNodeRunning",
      });
    this.replaceNode(node.withPatch({ status: "running", runningAt: nowIso }));
    return ok(undefined);
  }
  markNodeTerminal(
    nodeId: WorkflowNodeId,
    status: TerminalWorkflowNodeStatus,
    reason: string | undefined,
    nowIso: string,
  ): Result<
    { readonly retryCoordInserted: WorkflowNodeId | null; readonly workflowFailed: boolean },
    WorkflowNodeNotFound | IllegalNodeTransition
  > {
    void reason;
    const node = this.nodeById(nodeId);
    if (node === undefined || node.workflowId !== this.id)
      return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId });
    if (isTerminalWorkflowNodeStatus(node.status))
      return ok({ retryCoordInserted: null, workflowFailed: false });
    if (this.status !== "running" && status !== "cancelled")
      return err({
        type: "IllegalNodeTransition",
        workflowId: this.id,
        nodeId,
        status: this.status,
        verb: "markNodeTerminal",
      });
    this.replaceNode(node.withPatch({ status, endedAt: nowIso }));
    return ok(this.checkStuckAndRecover(nowIso));
  }
  __snapshot(): WorkflowSnapshot {
    return this.snapshot;
  }
  __isDeleted(): boolean {
    return this.deleted;
  }
  get id(): WorkflowId {
    return this._id;
  }
  get brief(): string {
    return this._brief;
  }
  get details(): string | undefined {
    return this._details;
  }
  get coordinatorAgent(): string {
    return this._coordinatorAgent;
  }
  get status(): WorkflowStatus {
    return this._status;
  }
  get origin(): WorkflowOrigin {
    return this._origin;
  }
  get originId(): string | undefined {
    return this._originId;
  }
  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }
  get createdAt(): string {
    return this._createdAt;
  }
  get startedAt(): string | undefined {
    return this._startedAt;
  }
  get endedAt(): string | undefined {
    return this._endedAt;
  }
  get success(): WorkflowSuccess | undefined {
    return this._success;
  }
  get failure(): WorkflowFailure | undefined {
    return this._failure;
  }
  get cancellation(): WorkflowCancellation | undefined {
    return this._cancellation;
  }
  get nodes(): readonly WorkflowNodeEntity[] {
    return this._nodes;
  }
  get edges(): readonly WorkflowEdgeEntity[] {
    return this._edges;
  }

  private toTerminal(
    status: Exclude<WorkflowStatus, "running">,
    endedAt: string,
    payload: {
      readonly success?: WorkflowSuccess;
      readonly failure?: WorkflowFailure;
      readonly cancellation?: WorkflowCancellation;
    },
  ): Result<void, WorkflowAlreadyTerminal> {
    if (this.status !== "running")
      return err({ type: "WorkflowAlreadyTerminal", workflowId: this.id, status: this.status });
    this._status = status;
    this._endedAt = endedAt;
    this._success = payload.success;
    this._failure = payload.failure;
    this._cancellation = payload.cancellation;
    return ok(undefined);
  }
  private requireRunning(): Result<void, WorkflowAlreadyTerminal> {
    return this.status !== "running"
      ? err({ type: "WorkflowAlreadyTerminal", workflowId: this.id, status: this.status })
      : ok(undefined);
  }
  private checkStuckAndRecover(nowIso: string): {
    readonly retryCoordInserted: WorkflowNodeId | null;
    readonly workflowFailed: boolean;
  } {
    if (this.status !== "running" || this.nodes.length === 0)
      return { retryCoordInserted: null, workflowFailed: false };
    if (this.nodes.some((node) => !isTerminalWorkflowNodeStatus(node.status)))
      return { retryCoordInserted: null, workflowFailed: false };
    const leaves = structuralLeaves(this.nodes, this.edges);
    const stuckReason = classifyStuckReason(leaves);
    if (stuckReason === undefined) return { retryCoordInserted: null, workflowFailed: false };
    const prevCoord = this.mostRecentCoordTerminal();
    if (prevCoord === null) return { retryCoordInserted: null, workflowFailed: false };
    const prevAgent = (prevCoord.spec as { readonly agent?: unknown }).agent;
    if (typeof prevAgent !== "string" || prevAgent.length === 0)
      return { retryCoordInserted: null, workflowFailed: false };
    const prevRetry = extractWorkflowNodeRetryMetadata(prevCoord.metadata);
    const attempt = (prevRetry?.attempt ?? 0) + 1;
    if (attempt > STUCK_RETRY_MAX_ATTEMPTS) {
      this._status = "failed";
      this._endedAt = nowIso;
      this._failure = {
        kind: "substrate",
        reason: STUCK_RETRY_LIMIT,
        message: `stuck-coord recovery cap (${STUCK_RETRY_LIMIT}): exceeded ${STUCK_RETRY_MAX_ATTEMPTS} consecutive retry attempts without forward progress`,
      };
      this._success = undefined;
      this._cancellation = undefined;
      return { retryCoordInserted: null, workflowFailed: true };
    }
    const seen = new Set<WorkflowNodeId>();
    const parentIds: WorkflowNodeId[] = [];
    for (const id of [prevCoord.id, ...leaves.map((node) => node.id)]) {
      if (seen.has(id)) continue;
      seen.add(id);
      parentIds.push(id);
    }
    const retryNodeId = generateWorkflowNodeId();
    const inserted = this.addRetryCoordNode({
      nodeId: retryNodeId,
      parentIds,
      agent: prevAgent,
      retry: { of: prevCoord.id, reason: stuckReason, attempt },
      nowIso,
    });
    return inserted.isOk()
      ? { retryCoordInserted: retryNodeId, workflowFailed: false }
      : { retryCoordInserted: null, workflowFailed: false };
  }
  private parentEntities(
    parentIds: readonly WorkflowNodeId[],
  ): Result<readonly WorkflowNodeEntity[], WorkflowNodeNotFound> {
    const parents: WorkflowNodeEntity[] = [];
    for (const parentId of parentIds) {
      const parent = this.nodeById(parentId);
      if (parent === undefined || parent.workflowId !== this.id)
        return err({ type: "WorkflowNodeNotFound", workflowId: this.id, nodeId: parentId });
      parents.push(parent);
    }
    return ok(parents);
  }
  private rejectBadParentsForKind(
    kind: WorkflowNodeKind,
    parents: readonly WorkflowNodeEntity[],
  ): Result<void, ParentState> {
    if (kind !== WORKER_KIND && kind !== HUMAN_KIND) return ok(undefined);
    for (const parent of parents)
      if (parent.status === "failed" || parent.status === "cancelled")
        return err({
          type: "ParentState",
          workflowId: this.id,
          nodeKind: kind,
          parentNodeId: parent.id,
          parentStatus: parent.status,
        });
    return ok(undefined);
  }
  private enforceCoordChainInvariants(
    parentEntities: readonly WorkflowNodeEntity[],
    extraEdges: readonly { readonly from: WorkflowNodeId; readonly to: WorkflowNodeId }[] = [],
    extraNodes: readonly WorkflowNodeEntity[] = [],
  ): Result<void, OrphanCoordInsert | MultipleSuccessorCoords> {
    const coordParents = parentEntities.filter((parent) => parent.kind === COORDINATOR_KIND);
    if (coordParents.length === 0) {
      if (parentEntities.length === 0 && this.latestCoordIdWith(extraNodes) === null)
        return ok(undefined);
      return err({ type: "OrphanCoordInsert", workflowId: this.id });
    }
    const nodesById = new Map([...this.nodes, ...extraNodes].map((node) => [node.id, node]));
    const edges = [...this.edges.map((edge) => ({ from: edge.from, to: edge.to })), ...extraEdges];
    for (const coordParent of coordParents) {
      const childIds = edges.filter((edge) => edge.from === coordParent.id).map((edge) => edge.to);
      if (childIds.length === 0) continue;
      if (
        childIds
          .map((childId) => nodesById.get(childId))
          .some((child) => child?.kind === COORDINATOR_KIND)
      )
        return err({
          type: "MultipleSuccessorCoords",
          workflowId: this.id,
          coordParentNodeId: coordParent.id,
        });
    }
    return ok(undefined);
  }
  private latestCoordId(): WorkflowNodeId | null {
    return this.latestCoordIdWith([]);
  }
  private latestCoordIdWith(extraNodes: readonly WorkflowNodeEntity[]): WorkflowNodeId | null {
    const coords = [...this.nodes, ...extraNodes].filter((node) => node.kind === COORDINATOR_KIND);
    coords.sort(
      (left, right) =>
        compareDesc(left.createdAt, right.createdAt) || compareDesc(left.id, right.id),
    );
    return coords[0]?.id ?? null;
  }
  private mostRecentCoordTerminal(): WorkflowNodeEntity | null {
    const coords = this.nodes.filter(
      (node) => node.kind === COORDINATOR_KIND && isTerminalWorkflowNodeStatus(node.status),
    );
    coords.sort(
      (left, right) =>
        compareDesc(left.endedAt ?? "", right.endedAt ?? "") ||
        compareDesc(left.createdAt, right.createdAt) ||
        compareDesc(left.id, right.id),
    );
    return coords[0] ?? null;
  }
  private wouldCreateCycle(newEdge: {
    readonly from: WorkflowNodeId;
    readonly to: WorkflowNodeId;
  }): boolean {
    return wouldCreateCycle(this.edges, newEdge);
  }
  private recomputePhases(
    startNodeIds: readonly WorkflowNodeId[],
    insertedNodes: readonly WorkflowNodeEntity[] = [],
    insertedEdges: readonly { readonly from: WorkflowNodeId; readonly to: WorkflowNodeId }[] = [],
    deletedNodeIds: readonly WorkflowNodeId[] = [],
    deletedEdges: readonly { readonly from: WorkflowNodeId; readonly to: WorkflowNodeId }[] = [],
  ): ReadonlyMap<WorkflowNodeId, number> {
    if (startNodeIds.length === 0) return new Map();
    const deletedNodeSet = new Set(deletedNodeIds);
    const nodes = [...this.nodes.filter((node) => !deletedNodeSet.has(node.id)), ...insertedNodes];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const deletedEdgeKeys = new Set(deletedEdges.map((edge) => edgeKey(edge.from, edge.to)));
    const edges = [
      ...this.edges
        .filter((edge) => !deletedNodeSet.has(edge.from) && !deletedNodeSet.has(edge.to))
        .filter((edge) => !deletedEdgeKeys.has(edgeKey(edge.from, edge.to)))
        .map((edge) => ({ from: edge.from, to: edge.to })),
      ...insertedEdges,
    ];
    const childrenOf = new Map<WorkflowNodeId, WorkflowNodeId[]>();
    const parentsOfMap = new Map<WorkflowNodeId, WorkflowNodeId[]>();
    for (const edge of edges) {
      const children = childrenOf.get(edge.from) ?? [];
      children.push(edge.to);
      childrenOf.set(edge.from, children);
      const parents = parentsOfMap.get(edge.to) ?? [];
      parents.push(edge.from);
      parentsOfMap.set(edge.to, parents);
    }
    const inScope = new Set<WorkflowNodeId>();
    const queue: WorkflowNodeId[] = [];
    for (const seedId of startNodeIds) {
      const seed = byId.get(seedId);
      if (seed === undefined || seed.status !== "not_started" || inScope.has(seedId)) continue;
      inScope.add(seedId);
      queue.push(seedId);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const childId of childrenOf.get(current) ?? []) {
        if (inScope.has(childId)) continue;
        const node = byId.get(childId);
        if (node?.status === "not_started") {
          inScope.add(childId);
          queue.push(childId);
        }
      }
    }
    const indegrees = new Map<WorkflowNodeId, number>();
    for (const id of inScope) {
      let degree = 0;
      for (const parentId of parentsOfMap.get(id) ?? []) if (inScope.has(parentId)) degree += 1;
      indegrees.set(id, degree);
    }
    const ready: WorkflowNodeId[] = [];
    for (const [id, degree] of indegrees) if (degree === 0) ready.push(id);
    const diff = new Map<WorkflowNodeId, number>();
    while (ready.length > 0) {
      const current = ready.shift();
      if (current === undefined) continue;
      const parentIds = parentsOfMap.get(current) ?? [];
      let maxParentPhase = -1;
      for (const parentId of parentIds) {
        const phase = diff.has(parentId)
          ? (diff.get(parentId) as number)
          : (byId.get(parentId)?.phase ?? -1);
        if (phase > maxParentPhase) maxParentPhase = phase;
      }
      diff.set(current, maxParentPhase + 1);
      for (const childId of childrenOf.get(current) ?? []) {
        if (!inScope.has(childId)) continue;
        const nextDegree = (indegrees.get(childId) ?? 0) - 1;
        indegrees.set(childId, nextDegree);
        if (nextDegree === 0) ready.push(childId);
      }
    }
    return diff;
  }
  private applyPhaseUpdates(diff: ReadonlyMap<WorkflowNodeId, number>): void {
    for (const [id, phase] of diff) {
      const node = this.nodeById(id);
      if (node !== undefined && node.phase !== phase) this.replaceNode(node.withPatch({ phase }));
    }
  }
  private children(nodeId: WorkflowNodeId): readonly WorkflowNodeId[] {
    return this.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
  }
  private parents(nodeId: WorkflowNodeId): readonly WorkflowNodeId[] {
    return this.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
  }
  private nodeById(id: WorkflowNodeId): WorkflowNodeEntity | undefined {
    return this.nodes.find((node) => node.id === id);
  }
  private replaceNode(updated: WorkflowNodeEntity): void {
    this._nodes = this._nodes.map((node) => (node.id === updated.id ? updated : node));
  }
  private patchCoordinatorAgent(spec: unknown): void {
    const agent = coordAgent(spec);
    if (agent !== undefined) this._coordinatorAgent = agent;
  }
}

export function normalizeSubgraphInput(input: {
  readonly nodes: readonly SubgraphTempNodeShape[];
  readonly edges: readonly SubgraphEdgeShape[];
}): NormalizedSubgraphInput {
  const nodes = input.nodes.map((node) => ({
    tempId: node.tempId,
    kind: node.kind,
    existingParents: Array.from(new Set(node.existingParents)),
  }));
  const seen = new Set<string>();
  const edges: SubgraphEdgeShape[] = [];
  for (const edge of input.edges) {
    const key = `${serializeNodeRef(edge.from)}->${serializeNodeRef(edge.to)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: edge.from, to: edge.to });
  }
  return { nodes, edges };
}
export function validateSubgraphShape(
  workflowId: string,
  nodes: readonly SubgraphTempNodeShape[],
  edges: readonly SubgraphEdgeShape[],
): Result<void, SubgraphError> {
  if (nodes.length === 0) return err({ type: "WorkflowSubgraphEmpty" });
  const tempIds = new Set<string>();
  let coordCount = 0;
  for (const node of nodes) {
    if (typeof node.tempId !== "string" || node.tempId.length === 0)
      return err({
        type: "WorkflowSubgraphTempIdInvalid",
        reason: "tempId must be a non-empty string",
      });
    if (tempIds.has(node.tempId))
      return err({
        type: "WorkflowSubgraphTempIdInvalid",
        reason: `duplicate tempId "${node.tempId}"`,
      });
    tempIds.add(node.tempId);
    if (node.kind === COORDINATOR_KIND) coordCount++;
  }
  if (coordCount > 1) return err({ type: "WorkflowSubgraphMultipleCoordTemps", workflowId });
  for (const edge of edges) {
    if (edge.from.kind === "temp" && !tempIds.has(edge.from.tempId))
      return err({
        type: "WorkflowSubgraphNodeRefUnresolved",
        workflowId,
        refKind: "temp",
        refValue: edge.from.tempId,
      });
    if (edge.to.kind === "temp" && !tempIds.has(edge.to.tempId))
      return err({
        type: "WorkflowSubgraphNodeRefUnresolved",
        workflowId,
        refKind: "temp",
        refValue: edge.to.tempId,
      });
  }
  const intraIncoming = new Map<string, number>();
  for (const tempId of tempIds) intraIncoming.set(tempId, 0);
  for (const edge of edges)
    if (edge.from.kind === "temp" && edge.to.kind === "temp")
      intraIncoming.set(edge.to.tempId, (intraIncoming.get(edge.to.tempId) ?? 0) + 1);
  for (const node of nodes) {
    const parentCount = node.existingParents.length + (intraIncoming.get(node.tempId) ?? 0);
    if (parentCount === 0)
      return err({ type: "WorkflowSubgraphTempParentless", tempId: node.tempId });
  }
  return ok(undefined);
}
export function resolveSubgraphTopology(
  workflowId: string,
  nodes: readonly SubgraphTempNodeShape[],
  edges: readonly SubgraphEdgeShape[],
): Result<readonly SubgraphTempNodeShape[], SubgraphError> {
  const byTempId = new Map(nodes.map((node) => [node.tempId, node]));
  const inDeg = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  for (const tempId of byTempId.keys()) {
    inDeg.set(tempId, 0);
    outAdj.set(tempId, []);
  }
  for (const edge of edges) {
    if (edge.from.kind === "temp" && !byTempId.has(edge.from.tempId))
      return err({
        type: "WorkflowSubgraphNodeRefUnresolved",
        workflowId,
        refKind: "temp",
        refValue: edge.from.tempId,
      });
    if (edge.to.kind === "temp" && !byTempId.has(edge.to.tempId))
      return err({
        type: "WorkflowSubgraphNodeRefUnresolved",
        workflowId,
        refKind: "temp",
        refValue: edge.to.tempId,
      });
    if (edge.from.kind === "temp" && edge.to.kind === "temp") {
      outAdj.get(edge.from.tempId)?.push(edge.to.tempId);
      inDeg.set(edge.to.tempId, (inDeg.get(edge.to.tempId) ?? 0) + 1);
    }
  }
  const ready = [...inDeg]
    .filter(([, degree]) => degree === 0)
    .map(([tempId]) => tempId)
    .sort();
  const order: SubgraphTempNodeShape[] = [];
  while (ready.length > 0) {
    const cur = ready.shift() as string;
    const node = byTempId.get(cur);
    if (node !== undefined) order.push(node);
    const children = outAdj.get(cur) ?? [];
    children.sort();
    for (const child of children) {
      const degree = (inDeg.get(child) ?? 0) - 1;
      inDeg.set(child, degree);
      if (degree === 0) {
        let index = 0;
        while (index < ready.length && ready[index]! < child) index++;
        ready.splice(index, 0, child);
      }
    }
  }
  if (order.length !== nodes.length) {
    const processed = new Set(order.map((node) => node.tempId));
    for (const edge of edges)
      if (
        edge.from.kind === "temp" &&
        edge.to.kind === "temp" &&
        !processed.has(edge.from.tempId) &&
        !processed.has(edge.to.tempId)
      )
        return err({
          type: "WorkflowSubgraphCyclic",
          workflowId,
          from: edge.from.tempId,
          to: edge.to.tempId,
        });
    const tempId = nodes.find((node) => !processed.has(node.tempId))?.tempId ?? "<unknown>";
    return err({ type: "WorkflowSubgraphCyclic", workflowId, from: tempId, to: tempId });
  }
  return ok(order);
}
function captureSnapshot(args: WorkflowReconstituteArgs): WorkflowSnapshot {
  return Object.freeze({
    header: Object.freeze({
      brief: args.brief,
      details: args.details,
      coordinatorAgent: args.coordinatorAgent,
      status: args.status,
      origin: args.origin,
      originId: args.originId,
      metadata: Object.freeze({ ...args.metadata }),
      createdAt: args.createdAt,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      success: args.success,
      failure: args.failure,
      cancellation: args.cancellation,
    }),
    nodes: new Map(args.nodes.map((node) => [node.id, nodeSnapshot(node)])),
    edgeKeys: new Set(args.edges.map((edge) => edgeKey(edge.from, edge.to))),
  });
}
function emptySnapshot(): WorkflowSnapshot {
  return Object.freeze({
    header: null,
    nodes: new Map<WorkflowNodeId, WorkflowNodeSnapshot>(),
    edgeKeys: new Set<string>(),
  });
}
function nodeSnapshot(node: WorkflowNodeEntity): WorkflowNodeSnapshot {
  return Object.freeze({
    status: node.status,
    phase: node.phase,
    spec: node.spec,
    readyAt: node.readyAt,
    runningAt: node.runningAt,
    endedAt: node.endedAt,
    metadata: Object.freeze({ ...node.metadata }),
  });
}
function uniqueNodeIds(ids: readonly WorkflowNodeId[]): WorkflowNodeId[] {
  return Array.from(new Set(ids));
}
function coordAgent(spec: unknown): string | undefined {
  if (typeof spec !== "object" || spec === null) return undefined;
  const agent = (spec as { readonly agent?: unknown }).agent;
  return typeof agent === "string" ? agent : undefined;
}
function isNode(node: WorkflowNodeEntity | undefined): node is WorkflowNodeEntity {
  return node !== undefined;
}
function compareDesc(left: string, right: string): number {
  return right.localeCompare(left);
}
function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}
function serializeNodeRef(ref: NodeRef): string {
  return ref.kind === "existing" ? `existing:${ref.id}` : `temp:${ref.tempId}`;
}
function collectExistingIds(
  nodes: readonly SubgraphTempNodeShape[],
  edges: readonly SubgraphEdgeShape[],
): WorkflowNodeId[] {
  const ids = new Set<WorkflowNodeId>();
  for (const node of nodes) for (const id of node.existingParents) ids.add(id as WorkflowNodeId);
  for (const edge of edges) {
    if (edge.from.kind === "existing") ids.add(edge.from.id as WorkflowNodeId);
    if (edge.to.kind === "existing") ids.add(edge.to.id as WorkflowNodeId);
  }
  return [...ids];
}
function buildNewEdges(
  nodes: readonly SubgraphTempNodeShape[],
  edges: readonly SubgraphEdgeShape[],
  ids: ReadonlyMap<string, WorkflowNodeId>,
): { from: WorkflowNodeId; to: WorkflowNodeId }[] {
  const result: { from: WorkflowNodeId; to: WorkflowNodeId }[] = [];
  for (const node of nodes)
    for (const parent of node.existingParents)
      result.push({ from: parent as WorkflowNodeId, to: ids.get(node.tempId) as WorkflowNodeId });
  for (const edge of edges)
    result.push({
      from:
        edge.from.kind === "existing"
          ? (edge.from.id as WorkflowNodeId)
          : (ids.get(edge.from.tempId) as WorkflowNodeId),
      to:
        edge.to.kind === "existing"
          ? (edge.to.id as WorkflowNodeId)
          : (ids.get(edge.to.tempId) as WorkflowNodeId),
    });
  return result;
}
function parentIdsForTemp(
  tempId: string,
  nodes: readonly SubgraphTempNodeShape[],
  edges: readonly SubgraphEdgeShape[],
  ids: ReadonlyMap<string, WorkflowNodeId>,
): WorkflowNodeId[] {
  const result = new Set<WorkflowNodeId>();
  const node = nodes.find((candidate) => candidate.tempId === tempId);
  for (const parent of node?.existingParents ?? []) result.add(parent as WorkflowNodeId);
  for (const edge of edges)
    if (edge.to.kind === "temp" && edge.to.tempId === tempId)
      result.add(
        edge.from.kind === "existing"
          ? (edge.from.id as WorkflowNodeId)
          : (ids.get(edge.from.tempId) as WorkflowNodeId),
      );
  return [...result];
}
