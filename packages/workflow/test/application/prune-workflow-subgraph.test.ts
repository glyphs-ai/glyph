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

  it("prunes a mis-planned batch then re-adds a corrected one (roundtrip)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const wrong = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w1", spec: { agent: "w", brief: "wrong" } }],
      coordSpec: { agent: "coord-wrong" },
    });

    // Retract the entire mis-planned batch (worker + its trailing coord) in one save.
    const pruned = (
      await f.module.pruneSubgraph.execute({
        workflowId,
        nodeIds: [wrong.workerIds.w1!, wrong.coordId],
      })
    )._unsafeUnwrap();
    expect(pruned.prunedNodeIds).toEqual([wrong.workerIds.w1!, wrong.coordId]);

    // Re-add a corrected batch from the same still-running root coord — proving
    // pruneSubgraph is the structural inverse of addSubgraph and that the
    // save() diff-deletion leaves the graph in a re-addable state.
    const fixed = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w1", spec: { agent: "w", brief: "corrected" } }],
      coordSpec: { agent: "coord-fixed" },
    });

    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    // Only the root coord + corrected batch survive the roundtrip.
    expect(dag.nodes.map((n) => n.id).sort()).toEqual(
      [initialCoordNodeId, fixed.workerIds.w1!, fixed.coordId].sort(),
    );
    // Nothing from the pruned batch remains — neither as a node nor a dangling edge.
    const prunedIds = new Set<string>([wrong.workerIds.w1!, wrong.coordId]);
    expect(dag.nodes.some((n) => prunedIds.has(n.id))).toBe(false);
    expect(dag.edges.some((e) => prunedIds.has(e.from) || prunedIds.has(e.to))).toBe(false);
    // The corrected batch is wired to the root coord and to its own trailing coord.
    const edgeKeys = new Set(dag.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeKeys.has(`${initialCoordNodeId}->${fixed.workerIds.w1!}`)).toBe(true);
    expect(edgeKeys.has(`${fixed.workerIds.w1!}->${fixed.coordId}`)).toBe(true);
    expect(edgeKeys.has(`${initialCoordNodeId}->${fixed.coordId}`)).toBe(true);
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
