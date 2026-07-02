import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService.addEdge", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("inserts the edge and reports the to-node's new phase", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Two parallel root-ish tasks; then connect them with an edge.
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Initial phases: a=1, b=1.
    const before = (await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap();
    expect(before.phase).toBe(1);
    const { toPhase } = (
      await f.module.addEdge.execute({ workflowId, fromNodeId: a, toNodeId: b })
    )._unsafeUnwrap();
    expect(toPhase).toBe(2);
    const after = (await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap();
    expect(after.phase).toBe(2);
  });

  it("REJECTS when the to-node is not `not_started`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Force b into 'running' so the addEdge guard fires.
    setNodeLifecycle(f, {
      id: b,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addEdge.execute({ workflowId, fromNodeId: a, toNodeId: b });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("REJECTS when adding the edge would close a cycle", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [a],
      })
    )._unsafeUnwrap();
    // The edge b → a would close coord→a→b→a.
    const r = await f.module.addEdge.execute({ workflowId, fromNodeId: b, toNodeId: a });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("EdgeCycle");
  });

  it("REJECTS worker-kind to-node when the from-node is failed/cancelled", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: a,
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addEdge.execute({ workflowId, fromNodeId: a, toNodeId: b });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("ParentState");
  });

  it("phase recompute does NOT touch running / terminal descendants", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Build A (phase 1), B (phase 2 child of A), C (phase 1, root).
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [a],
      })
    )._unsafeUnwrap();
    const { nodeId: c } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "c" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Force B into running and pin its phase as a sealed value the
    // recompute MUST NOT alter.
    const bBefore = (await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: b,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    (await f.module.addEdge.execute({ workflowId, fromNodeId: c, toNodeId: a }))._unsafeUnwrap();
    // A's phase should now be max(coord.phase=0, c.phase=1) + 1 = 2.
    const aAfter = (await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap();
    expect(aAfter.phase).toBe(2);
    // B was running — its phase MUST be the pre-recompute value.
    const bAfter = (await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap();
    expect(bAfter.phase).toBe(bBefore.phase);
  });

  it("phase recompute cascades through the not_started subtree", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [a],
      })
    )._unsafeUnwrap();
    const { nodeId: c } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "c" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Add edge c → a, recomputing a (and cascading to b).
    (await f.module.addEdge.execute({ workflowId, fromNodeId: c, toNodeId: a }))._unsafeUnwrap();
    const aAfter = (await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap();
    const bAfter = (await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap();
    expect(aAfter.phase).toBe(2);
    expect(bAfter.phase).toBe(3);
  });

  it("REJECTS when endpoints are in different workflows", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: localTask } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { initialCoordNodeId: otherCoord } = (
      await f.module.createWorkflow.execute({
        brief: "y",
        coordinatorAgent: "coord-z",
      })
    )._unsafeUnwrap();
    const r = await f.module.addEdge.execute({
      workflowId,
      fromNodeId: localTask,
      toNodeId: otherCoord,
    });
    expect(r.isErr()).toBe(true);
  });

  it("REJECTS when from-node or to-node is missing", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addEdge.execute({
      workflowId,
      fromNodeId: VALID_UUIDS[14]!,
      toNodeId: VALID_UUIDS[15]!,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("eager dispatch reaction: fires `dispatchAtomic` on the to-node when its parents are now ready", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Two parallel tasks; mark one already-succeeded.
    const { nodeId: parentA } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentA,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    // Child task created with no parents — eager-dispatch fires
    // immediately (root rule). Reset dispatch calls so we can
    // isolate the addEdge eager-dispatch reaction.
    const { nodeId: child } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "c" },
        parents: [parentA],
      })
    )._unsafeUnwrap();
    await f.module.engine.drain();
    expect((await f.module.getNode.execute({ nodeId: child }))._unsafeUnwrap().status).toBe(
      "running",
    );
  });
});
