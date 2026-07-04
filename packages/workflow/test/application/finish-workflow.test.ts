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

describe("WorkflowService.finishWorkflow", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("flips the workflow to the requested terminal status", async () => {
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.status).toBe("succeeded");
    expect(wf.endedAt).toBeDefined();
  });

  it("CAS once-only: a second call throws WorkflowAlreadyTerminalError", async () => {
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    // After the first call, the workflow is terminal. The
    // substrate's CAS-guarded UPDATE matches zero rows the second
    // time and the service throws `WorkflowAlreadyTerminalError`.
    const r = await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });

  it("EXCLUDES running coordinator-kind nodes from the cancel reconciliation", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "pending", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const pendingTask = workerIds.pending!;
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: pendingTask }))._unsafeUnwrap().status,
    ).toBe("not_started");

    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();

    // Caller coord remains running (substrate must NOT cancel the
    // very task that just called finishWorkflow). The reconciliation
    // explicitly excludes running coordinator-kind nodes so the
    // in-flight call frame can exit naturally.
    const caller = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(caller.status).toBe("running");

    // Pending task is cancelled by reconciliation.
    const pending = (
      await f.module.getNode.execute({ workflowId, nodeId: pendingTask })
    )._unsafeUnwrap();
    expect(pending.status).toBe("cancelled");
  });

  it("invokes runner.cancel on running non-coord nodes during reconciliation", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "running", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const runningTask = workerIds.running!;
    setNodeLifecycle(f, {
      id: runningTask,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: runningTask }))._unsafeUnwrap().status,
    ).toBe("running");

    (
      await f.module.finishWorkflow.execute({
        workflowId,
        outcome: "failed",
        failure: { kind: "coordinator", message: "ran out of budget" },
      })
    )._unsafeUnwrap();

    expect(f.workerRunner.cancelCalls).toContain(runningTask);
    expect(
      (await f.module.getNode.execute({ workflowId, nodeId: runningTask }))._unsafeUnwrap().status,
    ).toBe("cancelled");
  });

  it("REJECTS an invalid outcome value", async () => {
    const { workflowId } = await bootstrap(f);
    expect(() =>
      f.module.finishWorkflow.execute({
        workflowId,
        outcome: "cancelled" as "succeeded",
      }),
    ).toThrow();
  });

  it("a second finishWorkflow attempt after a successful one is blocked by the CAS", async () => {
    // The first call wins; the second sees workflow.status='succeeded'
    // and the CAS-guarded UPDATE matches no rows. The service throws
    // `WorkflowAlreadyTerminalError`.
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    const r = await f.module.finishWorkflow.execute({
      workflowId,
      outcome: "failed",
      failure: { kind: "coordinator", message: "x" },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });

  it("persists success.output when supplied with outcome='succeeded'", async () => {
    const { workflowId } = await bootstrap(f);
    (
      await f.module.finishWorkflow.execute({
        workflowId,
        outcome: "succeeded",
        success: { output: "All sub-runs converged on green." },
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.success).toEqual({ output: "All sub-runs converged on green." });
    expect(wf.failure).toBeUndefined();
    expect(wf.cancellation).toBeUndefined();
  });

  it("defaults success.output to null when omitted with outcome='succeeded'", async () => {
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.success).toEqual({ output: null });
  });

  it("persists failure.message + failure.kind when supplied with outcome='failed'", async () => {
    const { workflowId } = await bootstrap(f);
    (
      await f.module.finishWorkflow.execute({
        workflowId,
        outcome: "failed",
        failure: { kind: "coordinator", message: "budget exhausted" },
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.failure).toEqual({ kind: "coordinator", message: "budget exhausted" });
    expect(wf.success).toBeUndefined();
  });

  it("REJECTS outcome='failed' with no failure payload", async () => {
    const { workflowId } = await bootstrap(f);
    const request = { workflowId, outcome: "failed" } as Parameters<
      typeof f.module.finishWorkflow.execute
    >[0];
    expect(() => f.module.finishWorkflow.execute(request)).toThrow();
  });
});
