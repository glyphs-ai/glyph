import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowModule.cancelNode", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("cancels a worker-kind node in `not_started`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;

    expect((await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap();

    expect(n.status).toBe("cancelled");
    expect(n.endedAt).toBeDefined();
    expect(f.workerRunner.cancelCalls).toEqual([]);
  });

  it("cancels a worker-kind node in `running` and routes through runner.cancel post-commit", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;
    await setNodeLifecycle(f, {
      id: nodeId,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });

    expect((await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status).toBe(
      "running",
    );
    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap();

    expect(n.status).toBe("cancelled");
    expect(f.workerRunner.cancelCalls).toEqual([nodeId]);
  });

  it("REJECTS coordinator-kind nodes (worker-kind only)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);

    const r = await f.module.cancelNode.execute({ workflowId, nodeId: initialCoordNodeId });

    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("REJECTS already-terminal nodes (succeeded / failed / cancelled)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;
    await setNodeLifecycle(f, {
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
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "w", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const nodeId = workerIds.w!;
    await setNodeLifecycle(f, {
      id: nodeId,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    f.workerRunner.cancelShouldThrow = true;

    (await f.module.cancelNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    const n = (await f.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap();

    expect(n.status).toBe("cancelled");
    expect(f.workerRunner.cancelCalls).toEqual([nodeId]);
  });

  it("REJECTS when the target node belongs to a different workflow than `args.workflowId`", async () => {
    const { workflowId } = await bootstrap(f);
    const { workflowId: otherWorkflowId, initialCoordNodeId: otherCoord } = (
      await f.module.createWorkflow.execute({
        brief: "other",
        coordinatorAgent: "coord-z",
      })
    )._unsafeUnwrap();
    const { workerIds } = await addIteration(f, {
      workflowId: otherWorkflowId,
      parentCoordId: otherCoord,
      nodes: [{ tempId: "remote", spec: { agent: "w", brief: "remote" } }],
      coordSpec: { agent: "coord-other-next" },
    });

    const r = await f.module.cancelNode.execute({ workflowId, nodeId: workerIds.remote! });

    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("throws WorkflowNodeNotFoundError on a missing target node", async () => {
    const { workflowId } = await bootstrap(f);

    const r = await f.module.cancelNode.execute({ workflowId, nodeId: VALID_UUIDS[15]! });

    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });
});
