import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService.replaceSpec", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── Happy paths ─────────────────────────────────────────

  it("swaps a worker spec and updates spec_json", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "v1" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.replaceNodeSpec.execute({
        workflowId,
        nodeId,
        newSpec: { agent: "w", brief: "v2", extra: "k" },
      })
    )._unsafeUnwrap();
    const node = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(node.spec).toEqual({ agent: "w", brief: "v2", extra: "k" });
    expect(node.kind).toBe("worker");
    // workflow's coord agent denorm is unchanged.
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.coordinatorAgent).toBe("coord-agent");
  });

  it("swaps the LATEST coord spec and refreshes workflows.coordinator_agent", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: newCoord } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-v2" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.replaceNodeSpec.execute({
        workflowId,
        nodeId: newCoord,
        newSpec: { agent: "coord-v3", note: "updated" },
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.coordinatorAgent).toBe("coord-v3");
    const node = (await f.module.getNode.execute({ nodeId: newCoord }))._unsafeUnwrap();
    expect((node.spec as { agent: string }).agent).toBe("coord-v3");
  });

  it("does NOT refresh denorm when replacing an EARLIER coord's spec", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // The bootstrap coord is running. Add coord-B as a child of the
    // bootstrap coord (legal because the bootstrap coord has no other
    // coord-direct-child yet). After insert, addNode flips the
    // workflows.coordinator_agent denorm to coord-B (the new latest).
    const { nodeId: coordB } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-B" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    expect(
      (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap().coordinatorAgent,
    ).toBe("coord-B");
    // Flip the bootstrap coord back to not_started so it is replaceable,
    // and promote coord-B to running so it becomes the new auth caller.
    setNodeLifecycle(f, {
      id: initialCoordNodeId,
      status: "not_started",
      runningAt: null,
    });
    setNodeLifecycle(f, {
      id: coordB,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    (
      await f.module.replaceNodeSpec.execute({
        workflowId,
        nodeId: initialCoordNodeId,
        newSpec: { agent: "coord-EARLIER-replaced" },
      })
    )._unsafeUnwrap();
    // Denorm should remain `coord-B` because coord-B is still the
    // latest coord by created_at.
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.coordinatorAgent).toBe("coord-B");
  });

  it("invokes runner.validate with the correct ctx and persists the returned spec", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "v1" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    f.workerRunner.validateCalls.length = 0;
    f.workerRunner.validateReturnValue = { agent: "w-canon", brief: "canonical" };
    (
      await f.module.replaceNodeSpec.execute({
        workflowId,
        nodeId,
        newSpec: { agent: "w", brief: "user-input" },
      })
    )._unsafeUnwrap();
    expect(f.workerRunner.validateCalls.length).toBe(1);
    const call = f.workerRunner.validateCalls[0]!;
    expect(call.spec).toEqual({ agent: "w", brief: "user-input" });
    expect(call.ctx.workflowId).toBe(workflowId);
    expect(call.ctx.workflowStatus).toBe("running");
    const node = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(node.spec).toEqual({ agent: "w-canon", brief: "canonical" });
  });

  // ─── Sad paths ───────────────────────────────────────────

  it("REJECTS when runner.validate throws", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "v1" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    f.workerRunner.validateShouldThrow = new Error("bad spec");
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId,
      newSpec: { agent: "w", brief: "v2" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("NodeSpecError");
    const node = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(node.spec).toEqual({ agent: "w", brief: "v1" });
  });

  it("REJECTS when status != not_started", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "v1" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: nodeId,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId,
      newSpec: { agent: "w", brief: "v2" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("throws WorkflowNodeNotFoundError on missing target", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId: VALID_UUIDS[15]!,
      newSpec: { agent: "w" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("REJECTS cross-workflow target", async () => {
    const { workflowId } = await bootstrap(f);
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
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId: otherTask,
      newSpec: { agent: "w" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("REJECTS coord-kind spec missing `agent`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: newCoord } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-v2" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Have validate return a shape WITHOUT `agent` — should trip
    // assertCoordinatorSpecAgent.
    f.coordRunner.validateReturnValue = { note: "missing agent" };
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId: newCoord,
      newSpec: { something: "else" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("NodeSpecError");
  });

  // ─── Workflow lifecycle gate ─────────────────────────────

  it("REJECTS when workflow is terminal", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "v1" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.replaceNodeSpec.execute({
      workflowId,
      nodeId,
      newSpec: { agent: "w", brief: "v2" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});
