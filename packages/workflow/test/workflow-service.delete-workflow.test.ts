import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowDeleteRequiresTerminalError, WorkflowNotFoundError } from "../src/errors.js";
import { workflowDir } from "../src/paths.js";
import {
  bootstrap,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  makeWorkflowTestHandle,
  VALID_UUIDS,
  type WorkflowTestHandle,
} from "./_helpers.js";

describe("WorkflowService.deleteWorkflow", () => {
  let h: WorkflowTestHandle;

  beforeEach(() => {
    h = makeWorkflowTestHandle({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(() => {
    h.close();
  });

  it("drops the workflow row + every owned node + every owned edge in one tx", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(h);
    const { nodeId: a } = await h.service.addNode(workflowId, {
      kind: "worker",
      spec: { agent: "w", brief: "a" },
      parents: [initialCoordNodeId],
    });
    const { nodeId: b } = await h.service.addNode(workflowId, {
      kind: "worker",
      spec: { agent: "w", brief: "b" },
      parents: [initialCoordNodeId],
    });
    await h.service.cancelWorkflow(workflowId, {
      cancellation: { kind: "user", message: "" },
    });

    await h.service.deleteWorkflow(workflowId);

    await expect(h.service.getWorkflow(workflowId)).rejects.toBeInstanceOf(WorkflowNotFoundError);
    await expect(h.service.getNode(initialCoordNodeId)).rejects.toBeTruthy();
    await expect(h.service.getNode(a)).rejects.toBeTruthy();
    await expect(h.service.getNode(b)).rejects.toBeTruthy();
  });

  it("rejects a running workflow with WorkflowDeleteRequiresTerminalError", async () => {
    const { workflowId } = await bootstrap(h);
    await expect(h.service.deleteWorkflow(workflowId)).rejects.toBeInstanceOf(
      WorkflowDeleteRequiresTerminalError,
    );
    // Sanity: the workflow + initial coord are still there.
    const wf = await h.service.getWorkflow(workflowId);
    expect(wf.status).toBe("running");
  });

  it("rejects an unknown workflow with WorkflowNotFoundError", async () => {
    await expect(h.service.deleteWorkflow(MISSING_WORKFLOW_ID)).rejects.toBeInstanceOf(
      WorkflowNotFoundError,
    );
  });

  it("with purgeDir: removes the on-disk shared workflow dir", async () => {
    const { workflowId } = await bootstrap(h);
    // Seed a file in the shared workflow dir so we can prove it was
    // removed. The substrate creates the dir lazily on first artifact
    // write; we create it here to bypass that.
    const wfDir = workflowDir(h.workspaceDir, workflowId);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "marker.txt"), "x");
    expect(existsSync(wfDir)).toBe(true);

    await h.service.cancelWorkflow(workflowId, {
      cancellation: { kind: "user", message: "" },
    });
    await h.service.deleteWorkflow(workflowId, { purgeDir: true });

    expect(existsSync(wfDir)).toBe(false);
  });

  it("without purgeDir: preserves the on-disk shared workflow dir (archive mode)", async () => {
    const { workflowId } = await bootstrap(h);
    const wfDir = workflowDir(h.workspaceDir, workflowId);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "marker.txt"), "x");

    await h.service.cancelWorkflow(workflowId, {
      cancellation: { kind: "user", message: "" },
    });
    await h.service.deleteWorkflow(workflowId);

    expect(existsSync(wfDir)).toBe(true);
  });

  it("succeeded workflow is deletable (terminal-status gate accepts every terminal)", async () => {
    const { workflowId } = await bootstrap(h);
    await h.service.finishWorkflow(workflowId, { outcome: "succeeded" });
    await h.service.deleteWorkflow(workflowId);
    await expect(h.service.getWorkflow(workflowId)).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it("idempotency: a second call yields WorkflowNotFoundError (no silent re-success)", async () => {
    const { workflowId } = await bootstrap(h);
    await h.service.cancelWorkflow(workflowId, {
      cancellation: { kind: "user", message: "" },
    });
    await h.service.deleteWorkflow(workflowId);
    await expect(h.service.deleteWorkflow(workflowId)).rejects.toBeInstanceOf(
      WorkflowNotFoundError,
    );
  });

  it("WorkflowDeleteRequiresTerminalError carries the offending workflowId + status", async () => {
    const { workflowId } = await bootstrap(h);
    try {
      await h.service.deleteWorkflow(workflowId);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowDeleteRequiresTerminalError);
      const err = e as WorkflowDeleteRequiresTerminalError;
      expect(err.workflowId).toBe(workflowId);
      expect(err.status).toBe("running");
    }
  });
});
