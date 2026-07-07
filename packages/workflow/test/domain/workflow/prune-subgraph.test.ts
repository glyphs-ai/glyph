import { describe, expect, it } from "vitest";
import { WorkflowEdgeEntity } from "../../../src/domain/edge/workflow-edge-entity.js";
import { WorkflowNodeEntity } from "../../../src/domain/node/workflow-node-entity.js";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";
import type { WorkflowNodeKind } from "../../../src/domain/node/workflow-node-kind.js";
import type { WorkflowNodeStatus } from "../../../src/domain/node/workflow-node-status.js";
import { WorkflowBriefSchema } from "../../../src/domain/workflow/workflow-brief.js";
import { WorkflowEntity } from "../../../src/domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";
import type { WorkflowStatus } from "../../../src/domain/workflow/workflow-status.js";

const WF_ID = WorkflowIdSchema.parse("20260707-00000001");
const NOW = "2026-07-07T00:00:00.000Z";

const IDS = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440003",
  "550e8400-e29b-41d4-a716-446655440004",
  "550e8400-e29b-41d4-a716-446655440005",
  "550e8400-e29b-41d4-a716-44665544000f",
].map((u) => WorkflowNodeIdSchema.parse(u));
const [C0, W1, C1, W2, C2, WA, ABSENT] = IDS as [
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
];

const TERMINAL: ReadonlySet<WorkflowNodeStatus> = new Set(["succeeded", "failed", "cancelled"]);

function node(opts: {
  readonly id: WorkflowNodeId;
  readonly kind: WorkflowNodeKind;
  readonly phase: number;
  readonly status?: WorkflowNodeStatus;
}): WorkflowNodeEntity {
  const status = opts.status ?? "not_started";
  return WorkflowNodeEntity.reconstitute({
    id: opts.id,
    workflowId: WF_ID,
    kind: opts.kind,
    spec: opts.kind === "coordinator" ? { agent: "c" } : { agent: "w", brief: "b" },
    phase: opts.phase,
    status,
    metadata: {},
    createdAt: NOW,
    readyAt: undefined,
    runningAt: undefined,
    endedAt: TERMINAL.has(status) ? NOW : undefined,
    specVersion: 0,
  });
}

function edge(from: WorkflowNodeId, to: WorkflowNodeId): WorkflowEdgeEntity {
  return WorkflowEdgeEntity.reconstitute({ workflowId: WF_ID, from, to });
}

function workflow(
  nodes: readonly WorkflowNodeEntity[],
  edges: readonly WorkflowEdgeEntity[],
  status: WorkflowStatus = "running",
): WorkflowEntity {
  return WorkflowEntity.reconstitute({
    id: WF_ID,
    brief: WorkflowBriefSchema.parse("prune-test"),
    details: undefined,
    coordinatorAgent: "c",
    status,
    origin: "standalone",
    originId: undefined,
    metadata: {},
    createdAt: NOW,
    startedAt: NOW,
    endedAt: undefined,
    success: undefined,
    failure: undefined,
    cancellation: undefined,
    nodes,
    edges,
  });
}

/** C0(root) → {W1, C1}; W1 → C1. The canonical one-iteration frontier. */
function oneIteration(): WorkflowEntity {
  return workflow(
    [
      node({ id: C0, kind: "coordinator", phase: 0 }),
      node({ id: W1, kind: "worker", phase: 1 }),
      node({ id: C1, kind: "coordinator", phase: 1 }),
    ],
    [edge(C0, W1), edge(C0, C1), edge(W1, C1)],
  );
}

describe("WorkflowEntity.pruneSubgraph — happy paths", () => {
  it("prunes a trailing coordinator leaf and its adjacent edges", () => {
    const wf = oneIteration();
    const res = wf.pruneSubgraph({ nodeIds: [C1] });
    expect(res.isOk()).toBe(true);
    const value = res._unsafeUnwrap();
    expect(value.prunedNodeIds).toEqual([C1]);
    expect(value.prunedEdges).toEqual(
      expect.arrayContaining([
        { from: C0, to: C1 },
        { from: W1, to: C1 },
      ]),
    );
    expect(value.prunedEdges).toHaveLength(2);
    expect(wf.nodes.map((n) => n.id)).toEqual([C0, W1]);
    expect(wf.edges.map((e) => [e.from, e.to])).toEqual([[C0, W1]]);
  });

  it("prunes an intermediate worker while its downstream coord keeps a coord parent", () => {
    const wf = oneIteration();
    const res = wf.pruneSubgraph({ nodeIds: [W1] });
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().prunedNodeIds).toEqual([W1]);
    expect(wf.nodes.map((n) => n.id)).toEqual([C0, C1]);
    expect(wf.edges.map((e) => [e.from, e.to])).toEqual([[C0, C1]]);
  });

  it("prunes multiple nodes atomically", () => {
    const wf = oneIteration();
    const res = wf.pruneSubgraph({ nodeIds: [W1, C1] });
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().prunedNodeIds).toEqual([W1, C1]);
    expect(wf.nodes.map((n) => n.id)).toEqual([C0]);
    expect(wf.edges).toHaveLength(0);
  });

  it("dedupes repeated ids in the request", () => {
    const wf = oneIteration();
    const res = wf.pruneSubgraph({ nodeIds: [C1, C1] });
    expect(res._unsafeUnwrap().prunedNodeIds).toEqual([C1]);
  });
});

describe("WorkflowEntity.pruneSubgraph — rejections", () => {
  it("rejects a terminal workflow with WorkflowAlreadyTerminal before any check", () => {
    const wf = workflow(
      [node({ id: C0, kind: "coordinator", phase: 0, status: "succeeded" })],
      [],
      "succeeded",
    );
    const res = wf.pruneSubgraph({ nodeIds: [C0] });
    expect(res._unsafeUnwrapErr()).toEqual({
      type: "WorkflowAlreadyTerminal",
      workflowId: WF_ID,
      status: "succeeded",
    });
  });

  it("rejects nodeNotFound when a target id is absent", () => {
    const wf = oneIteration();
    const err = wf.pruneSubgraph({ nodeIds: [ABSENT] })._unsafeUnwrapErr();
    expect(err.type).toBe("WorkflowPruneRejected");
    if (err.type !== "WorkflowPruneRejected") throw new Error("unreachable");
    expect(err.reason).toEqual({ kind: "nodeNotFound", workflowId: WF_ID, nodeId: ABSENT });
  });

  it("rejects nodeNotStarted when a target has already started", () => {
    const wf = workflow(
      [
        node({ id: C0, kind: "coordinator", phase: 0 }),
        node({ id: W1, kind: "worker", phase: 1, status: "running" }),
        node({ id: C1, kind: "coordinator", phase: 1 }),
      ],
      [edge(C0, W1), edge(C0, C1), edge(W1, C1)],
    );
    const err = wf.pruneSubgraph({ nodeIds: [W1] })._unsafeUnwrapErr();
    if (err.type !== "WorkflowPruneRejected") throw new Error("unreachable");
    expect(err.reason).toEqual({
      kind: "nodeNotStarted",
      workflowId: WF_ID,
      nodeId: W1,
      status: "running",
    });
    // Rejected up front → the aggregate is untouched.
    expect(wf.nodes).toHaveLength(3);
  });

  it("rejects rootCoordProtected when a target is the phase-0 coordinator", () => {
    const wf = oneIteration();
    const err = wf.pruneSubgraph({ nodeIds: [C0] })._unsafeUnwrapErr();
    if (err.type !== "WorkflowPruneRejected") throw new Error("unreachable");
    expect(err.reason).toEqual({ kind: "rootCoordProtected", workflowId: WF_ID, nodeId: C0 });
  });

  it("rejects orphan when a survivor would lose all parents", () => {
    // Two iterations: C0 → {W1, C1}; C1 → {W2, C2}. Pruning C1 orphans W2.
    const wf = workflow(
      [
        node({ id: C0, kind: "coordinator", phase: 0 }),
        node({ id: W1, kind: "worker", phase: 1 }),
        node({ id: C1, kind: "coordinator", phase: 1 }),
        node({ id: W2, kind: "worker", phase: 2 }),
        node({ id: C2, kind: "coordinator", phase: 2 }),
      ],
      [edge(C0, W1), edge(C0, C1), edge(W1, C1), edge(C1, W2), edge(C1, C2), edge(W2, C2)],
    );
    const err = wf.pruneSubgraph({ nodeIds: [C1] })._unsafeUnwrapErr();
    if (err.type !== "WorkflowPruneRejected") throw new Error("unreachable");
    expect(err.reason).toEqual({ kind: "orphan", workflowId: WF_ID, nodeId: W2 });
    expect(wf.nodes).toHaveLength(5);
  });

  it("rejects coordChainBroken when a surviving coord would keep only a worker parent", () => {
    // C0 → {C1, WA}; {C1, WA} → C2. Pruning C1 leaves C2 with only worker
    // parent WA (WA itself still has C0), so the failure is coordChainBroken,
    // not orphan.
    const wf = workflow(
      [
        node({ id: C0, kind: "coordinator", phase: 0 }),
        node({ id: C1, kind: "coordinator", phase: 1 }),
        node({ id: WA, kind: "worker", phase: 1 }),
        node({ id: C2, kind: "coordinator", phase: 2 }),
      ],
      [edge(C0, C1), edge(C0, WA), edge(C1, C2), edge(WA, C2)],
    );
    const err = wf.pruneSubgraph({ nodeIds: [C1] })._unsafeUnwrapErr();
    if (err.type !== "WorkflowPruneRejected") throw new Error("unreachable");
    expect(err.reason).toEqual({ kind: "coordChainBroken", workflowId: WF_ID, nodeId: C2 });
  });
});
