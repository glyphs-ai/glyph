import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowModule.pruneSubgraph", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("prunes a not-started trailing coordinator and drops its adjacent edges", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds, coordId } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [
        { tempId: "w1", spec: { agent: "w", brief: "w1" } },
        { tempId: "w2", spec: { agent: "w", brief: "w2" } },
      ],
      coordSpec: { agent: "coord-next" },
    });

    const res = (
      await f.module.pruneSubgraph.execute({ workflowId, nodeIds: [coordId] })
    )._unsafeUnwrap();

    expect(res.prunedNodeIds).toEqual([coordId]);
    // Every edge incident to the pruned coord is reported.
    expect(res.prunedEdges).toEqual(
      expect.arrayContaining([
        { from: initialCoordNodeId, to: coordId },
        { from: workerIds.w1!, to: coordId },
        { from: workerIds.w2!, to: coordId },
      ]),
    );

    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.map((n) => n.id).sort()).toEqual(
      [initialCoordNodeId, workerIds.w1!, workerIds.w2!].sort(),
    );
    expect(dag.edges.some((e) => e.to === coordId)).toBe(false);
  });

  it("prunes a single not-started worker", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w1", spec: { agent: "w", brief: "w1" } }],
      coordSpec: { agent: "coord-next" },
    });

    const res = (
      await f.module.pruneSubgraph.execute({ workflowId, nodeIds: [workerIds.w1!] })
    )._unsafeUnwrap();

    expect(res.prunedNodeIds).toEqual([workerIds.w1!]);
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.some((n) => n.id === workerIds.w1!)).toBe(false);
  });

  it("rejects pruning the root coordinator with rootCoordProtected", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // The engine dispatches the bootstrap coord immediately; force it back to
    // not_started so the root-coord guard is reached ahead of the status guard.
    setNodeLifecycle(f, { id: initialCoordNodeId, status: "not_started", runningAt: null });
    const r = await f.module.pruneSubgraph.execute({
      workflowId,
      nodeIds: [initialCoordNodeId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowPruneRejected",
      reason: { kind: "rootCoordProtected", nodeId: initialCoordNodeId },
    });
  });

  it("rejects pruning a started node with nodeNotStarted", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w1", spec: { agent: "w", brief: "w1" } }],
      coordSpec: { agent: "coord-next" },
    });
    setNodeLifecycle(f, {
      id: workerIds.w1!,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });

    const r = await f.module.pruneSubgraph.execute({ workflowId, nodeIds: [workerIds.w1!] });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowPruneRejected",
      reason: { kind: "nodeNotStarted", status: "running" },
    });
  });

  it("rejects when the workflow does not exist", async () => {
    const r = await f.module.pruneSubgraph.execute({
      workflowId: MISSING_WORKFLOW_ID,
      nodeIds: [VALID_UUIDS[0]!],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });
});
