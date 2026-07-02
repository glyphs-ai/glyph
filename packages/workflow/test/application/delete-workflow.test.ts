import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowDir } from "../../src/infrastructure/file/workflow-sandbox.js";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService.deleteWorkflow", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("drops the workflow row + every owned node + every owned edge in one tx", async () => {
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
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();

    (await f.module.deleteWorkflow.execute({ workflowId }))._unsafeUnwrap();

    const wf = await f.module.getWorkflow.execute({ workflowId });
    expect(wf.isErr()).toBe(true);
    expect(wf._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
    expect((await f.module.getNode.execute({ nodeId: initialCoordNodeId })).isErr()).toBe(true);
    expect((await f.module.getNode.execute({ nodeId: a })).isErr()).toBe(true);
    expect((await f.module.getNode.execute({ nodeId: b })).isErr()).toBe(true);
  });

  it("rejects a running workflow with WorkflowDeleteRequiresTerminalError", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.deleteWorkflow.execute({ workflowId });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowDeleteRequiresTerminal");
    // Sanity: the workflow + initial coord are still there.
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.status).toBe("running");
  });

  it("rejects an unknown workflow with WorkflowNotFoundError", async () => {
    const r = await f.module.deleteWorkflow.execute({ workflowId: MISSING_WORKFLOW_ID });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("with purgeDir: removes the on-disk shared workflow dir", async () => {
    const { workflowId } = await bootstrap(f);
    // Seed a file in the shared workflow dir so we can prove it was
    // removed. The substrate creates the dir lazily on first artifact
    // write; we create it here to bypass that.
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "marker.txt"), "x");
    expect(existsSync(wfDir)).toBe(true);

    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    (await f.module.deleteWorkflow.execute({ workflowId, purgeDir: true }))._unsafeUnwrap();

    expect(existsSync(wfDir)).toBe(false);
  });

  it("without purgeDir: preserves the on-disk shared workflow dir (archive mode)", async () => {
    const { workflowId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "marker.txt"), "x");

    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    (await f.module.deleteWorkflow.execute({ workflowId }))._unsafeUnwrap();

    expect(existsSync(wfDir)).toBe(true);
  });

  it("succeeded workflow is deletable (terminal-status gate accepts every terminal)", async () => {
    const { workflowId } = await bootstrap(f);
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();
    (await f.module.deleteWorkflow.execute({ workflowId }))._unsafeUnwrap();
    const wf = await f.module.getWorkflow.execute({ workflowId });
    expect(wf.isErr()).toBe(true);
    expect(wf._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("idempotency: a second call yields WorkflowNotFoundError (no silent re-success)", async () => {
    const { workflowId } = await bootstrap(f);
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    (await f.module.deleteWorkflow.execute({ workflowId }))._unsafeUnwrap();
    const r = await f.module.deleteWorkflow.execute({ workflowId });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("WorkflowDeleteRequiresTerminalError carries the offending workflowId + status", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.deleteWorkflow.execute({ workflowId });
    expect(r.isErr()).toBe(true);
    const err = r._unsafeUnwrapErr();
    expect(err.type).toBe("WorkflowDeleteRequiresTerminal");
    if (err.type !== "WorkflowDeleteRequiresTerminal") {
      expect.fail("expected WorkflowDeleteRequiresTerminal");
    }
    expect(err.workflowId).toBe(workflowId);
    expect(err.status).toBe("running");
  });
});
