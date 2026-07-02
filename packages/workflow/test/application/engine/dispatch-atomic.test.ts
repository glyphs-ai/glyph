import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "../workflow-fixture.js";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`waitUntil timed out (${timeoutMs}ms): ${label}`);
}

describe("WorkflowService.dispatchAtomic", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("task: dispatches when ALL parents are succeeded", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    // Mark the coord parent succeeded by hand; manual dispatchAtomic now
    // observes a satisfied predicate.
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const before = f.workerRunner.dispatchCalls.length;
    (await f.module.engine.dispatch(workflowId, a))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().status).toBe("running");
    expect(f.workerRunner.dispatchCalls.length).toBe(before + 1);
  });

  it("task: does NOT dispatch when a parent is not yet succeeded", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Coord parent is still 'running' — predicate fails.
    const before = f.workerRunner.dispatchCalls.length;
    (await f.module.engine.dispatch(workflowId, a))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    expect(f.workerRunner.dispatchCalls.length).toBe(before);
  });

  it("coordinator: dispatches when ALL parents are terminal (succeeded OR failed OR cancelled)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentTask } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // childCoord must list its caller (initialCoord) as a parent.
    const { nodeId: childCoord } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-b" },
        parents: [initialCoordNodeId, parentTask],
      })
    )._unsafeUnwrap();
    // Mark both parents terminal: parentTask FAILED, initialCoord
    // SUCCEEDED. A worker-kind child would NOT dispatch (failed
    // parent) but a coord-kind child WILL.
    setNodeLifecycle(f, {
      id: parentTask,
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const before = f.coordRunner.dispatchCalls.length;
    (await f.module.engine.dispatch(workflowId, childCoord))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: childCoord }))._unsafeUnwrap().status).toBe(
      "running",
    );
    expect(f.coordRunner.dispatchCalls.length).toBe(before + 1);
  });

  it("silently no-ops when the node is already running", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const before = f.coordRunner.dispatchCalls.length;
    (await f.module.engine.dispatch(workflowId, initialCoordNodeId))._unsafeUnwrap();
    expect(
      (await f.module.getNode.execute({ nodeId: initialCoordNodeId }))._unsafeUnwrap().status,
    ).toBe("running");
    expect(f.coordRunner.dispatchCalls.length).toBe(before);
  });

  it("silently no-ops when the workflow is already cancelled", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    // Cancel reconciliation already flipped the task. dispatchAtomic
    // is a no-op for terminal nodes.
    const before = f.workerRunner.dispatchCalls.length;
    (await f.module.engine.dispatch(workflowId, nodeId))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status).toBe("cancelled");
    expect(f.workerRunner.dispatchCalls.length).toBe(before);
  });

  it("on runner.dispatch throw, marks the node failed via a separate tx", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Materialise a parent task and force it terminal so the new
    // task's parent-readiness predicate fires eager dispatch on insert.
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
    f.workerRunner.dispatchShouldThrow = true;
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () => (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status === "failed",
      2000,
      "node marked failed",
    );
    const n = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("failed");
    expect(n.endedAt).toBeDefined();
  });

  it("eager dispatch reaction from addNode commits then dispatches once", async () => {
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
    const before = f.workerRunner.dispatchCalls.length;
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "y" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () => (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status === "running",
      2000,
      "node becomes running",
    );
    expect((await f.module.getNode.execute({ nodeId }))._unsafeUnwrap().status).toBe("running");
    expect(f.workerRunner.dispatchCalls.length).toBe(before + 1);
  });
});
