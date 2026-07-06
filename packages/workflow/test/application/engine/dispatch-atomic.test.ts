import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addIteration,
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

describe("WorkflowEngine.dispatch", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("task: dispatches when ALL parents are succeeded", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "a", spec: { agent: "w", brief: "a" } }],
      coordSpec: { agent: "coord-next" },
    });
    const a = workerIds.a!;
    expect((await f.module.getNode.execute({ workflowId, nodeId: a }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const before = f.workerRunner.dispatchCalls.length;

    (await f.module.engine.dispatch(workflowId, a))._unsafeUnwrap();

    expect((await f.module.getNode.execute({ workflowId, nodeId: a }))._unsafeUnwrap().status).toBe(
      "running",
    );
    expect(f.workerRunner.dispatchCalls.length).toBe(before + 1);
  });

  it("task: does NOT dispatch when a parent is not yet succeeded", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "a", spec: { agent: "w", brief: "a" } }],
      coordSpec: { agent: "coord-next" },
    });
    const a = workerIds.a!;
    const before = f.workerRunner.dispatchCalls.length;

    (await f.module.engine.dispatch(workflowId, a))._unsafeUnwrap();

    expect((await f.module.getNode.execute({ workflowId, nodeId: a }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    expect(f.workerRunner.dispatchCalls.length).toBe(before);
  });

  it("coordinator: dispatches when ALL parents are terminal (succeeded OR failed OR cancelled)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds, coordId } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "parent", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-b" },
    });
    const parentTask = workerIds.parent!;
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

    (await f.module.engine.dispatch(workflowId, coordId))._unsafeUnwrap();

    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: coordId }))._unsafeUnwrap().status,
    ).toBe("running");
    expect(f.coordRunner.dispatchCalls.length).toBe(before + 1);
  });

  it("silently no-ops when the node is already running", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const before = f.coordRunner.dispatchCalls.length;

    (await f.module.engine.dispatch(workflowId, initialCoordNodeId))._unsafeUnwrap();

    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
        .status,
    ).toBe("running");
    expect(f.coordRunner.dispatchCalls.length).toBe(before);
  });

  it("silently no-ops when the workflow is already cancelled", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const before = f.workerRunner.dispatchCalls.length;

    (await f.module.engine.dispatch(workflowId, nodeId))._unsafeUnwrap();

    expect((await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status).toBe(
      "cancelled",
    );
    expect(f.workerRunner.dispatchCalls.length).toBe(before);
  });

  it("on runner.dispatch throw, marks the node failed via a separate tx", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    f.workerRunner.dispatchShouldThrow = true;
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;

    await waitUntil(
      async () =>
        (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "failed",
      2000,
      "node marked failed",
    );
    const n = (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("failed");
    expect(n.endedAt).toBeDefined();
  });

  it("eager dispatch reaction from addSubgraph commits then dispatches once", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const before = f.workerRunner.dispatchCalls.length;
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "y" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;

    await waitUntil(
      async () =>
        (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "running",
      2000,
      "node becomes running",
    );
    expect((await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status).toBe(
      "running",
    );
    expect(f.workerRunner.dispatchCalls.length).toBe(before + 1);
  });
});
