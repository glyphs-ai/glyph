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

describe("WorkflowModule.cancelWorkflow", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("flips the workflow to cancelled and ends every non-terminal node", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [
        { tempId: "pending", spec: { agent: "w", brief: "x" } },
        { tempId: "running", spec: { agent: "w", brief: "y" } },
      ],
      coordSpec: { agent: "coord-next" },
    });
    const pending = workerIds.pending!;
    const running = workerIds.running!;
    setNodeLifecycle(f, {
      id: running,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "operator stopped run" },
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.status).toBe("cancelled");
    // Every non-terminal node, INCLUDING the initial coord, is cancelled.
    const coord = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(coord.status).toBe("cancelled");
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: pending }))._unsafeUnwrap().status,
    ).toBe("cancelled");
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: running }))._unsafeUnwrap().status,
    ).toBe("cancelled");
    expect(f.workerRunner.cancelCalls).toContain(running);
    // Cancellation payload is persisted in the same tx as the
    // status flip — the next read sees both.
    expect(wf.cancellation).toEqual({ kind: "user", message: "operator stopped run" });
  });

  it("CAS once-only: a second call throws WorkflowAlreadyTerminalError", async () => {
    const { workflowId } = await bootstrap(f);
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "first" },
      })
    )._unsafeUnwrap();
    const r = await f.module.cancelWorkflow.execute({
      workflowId,
      cancellation: { kind: "user", message: "second" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });

  it("throws WorkflowNotFoundError on an unknown workflow", async () => {
    const r = await f.module.cancelWorkflow.execute({
      workflowId: MISSING_WORKFLOW_ID,
      cancellation: { kind: "user", message: "" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("does NOT call runner.cancel for not_started / not-yet-running nodes", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "pending", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const pending = workerIds.pending!;
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: pending }))._unsafeUnwrap().status,
    ).toBe("not_started");
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    // The pending task was cancelled by reconciliation but its handler was
    // never running — no abort call is needed.
    expect(f.workerRunner.cancelCalls).not.toContain(pending);
  });

  it("idempotent: succeeded → cancelWorkflow is rejected (workflow already terminal)", async () => {
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    const r = await f.module.cancelWorkflow.execute({
      workflowId,
      cancellation: { kind: "user", message: "" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});
