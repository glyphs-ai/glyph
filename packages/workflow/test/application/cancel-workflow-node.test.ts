import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService.cancelNode", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("cancels a worker-kind node in `not_started`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status).toBe("not_started");
    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("cancelled");
    expect(n.endedAt).toBeDefined();
    // No runner.cancel call for a not_started node — there's no
    // in-flight unit to abort.
    expect(f.workerRunner.cancelCalls).toEqual([]);
  });

  it("cancels a worker-kind node in `running` and routes through runner.cancel post-commit", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Materialise a parent task and force it terminal so the child
    // task lands in `running` via eager dispatch on insert.
    const { nodeId: parentTaskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentTaskId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await f.module.engine.drain();
    expect((await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status).toBe("running");
    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("cancelled");
    expect(f.workerRunner.cancelCalls).toEqual([nodeId]);
  });

  it("REJECTS coordinator-kind nodes (worker-kind only)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // The coord is the caller; we try to cancel ANOTHER coord.
    const { nodeId: otherCoord } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Coord-kind cancellation is deferred to cancelWorkflow; cancelNode is
    // worker-only, so cancelling a coord node is rejected as not-mutable.
    const r = await f.module.cancelNode.execute({ workflowId, nodeId: otherCoord });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("REJECTS already-terminal nodes (succeeded / failed / cancelled)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: nodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.cancelNode.execute({ workflowId, nodeId });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("runner.cancel failure is logged but the substrate still marks the node cancelled", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentTaskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentTaskId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await f.module.engine.drain();
    f.workerRunner.cancelShouldThrow = true;
    // Best-effort: a runner.cancel throw does not surface as an error; the DB
    // already committed the cancellation and the substrate state stays cancelled.
    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("cancelled");
    expect(f.workerRunner.cancelCalls).toEqual([nodeId]);
  });

  it("REJECTS when the target node belongs to a different workflow than `args.workflowId`", async () => {
    // The substrate looks up the target node by id; if it's in
    // workflow B but the caller named workflow A, the node is
    // reported as not-found (it's not present *in workflow A*).
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Bootstrap a second workflow with its own task.
    const { workflowId: otherWorkflowId, initialCoordNodeId: otherCoord } = (
      await f.module.createWorkflow.execute({
        brief: "other",
        coordinatorAgent: "coord-z",
      })
    )._unsafeUnwrap();
    const { nodeId: otherTask } = (
      await f.module.addNode.execute({
        workflowId: otherWorkflowId,
        kind: "worker",
        spec: { agent: "w", brief: "remote" },
        parents: [otherCoord],
      })
    )._unsafeUnwrap();
    const r = await f.module.cancelNode.execute({ workflowId, nodeId: otherTask });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
    void initialCoordNodeId;
  });

  it("throws WorkflowNodeNotFoundError on a missing target node", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.cancelNode.execute({ workflowId, nodeId: VALID_UUIDS[15]! });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });
});
