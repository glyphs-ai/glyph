import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildWorkflowFixture,
  fixedRandomBytes,
  fixedRandomUUID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("CreateWorkflowUseCase", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      // Deterministic 4-byte hex sequence for workflow ids; tests observe
      // `<YYYYMMDD>-<8hex>` shaped ids (the substrate mirrors generateTaskId).
      randomBytes: fixedRandomBytes(["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]),
      // Pinned date so the dated-id prefix is stable across runs.
      initialNow: new Date("2026-06-07T00:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await f.close();
  });

  it("creates workflow + initial coord node + denormalized coordinator_agent in one atomic boundary", async () => {
    const { workflowId, initialCoordNodeId } = (
      await f.module.createWorkflow.execute({ brief: "do the thing", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    expect(workflowId).toBe("20260607-aaaaaaaa");
    expect(initialCoordNodeId).toBe(VALID_UUIDS[0]);

    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.brief).toBe("do the thing");
    expect(wf.status).toBe("running");
    expect(wf.coordinatorAgent).toBe("coord-a");

    const coord = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(coord.kind).toBe("coordinator");
    expect(coord.phase).toBe(0);
    expect(coord.spec).toEqual({ agent: "coord-a" });
  });

  it("denorm invariant: `workflows.coordinator_agent` matches the last-inserted coord node's spec.agent", async () => {
    const { workflowId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const coords = dag.nodes.filter((n) => n.kind === "coordinator");
    expect(coords).toHaveLength(1);
    expect(wf.coordinatorAgent).toBe((coords[0]?.spec as { agent: string }).agent);
  });

  it("dispatch trigger: invokes the coordinator runner.dispatch for the initial coord node", async () => {
    const { workflowId, initialCoordNodeId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    expect(f.coordRunner.dispatchCalls).toHaveLength(1);
    const call = f.coordRunner.dispatchCalls[0]!;
    expect(call.workflowId).toBe(workflowId);
    expect(call.nodeId).toBe(initialCoordNodeId);
    expect(call.spec).toEqual({ agent: "coord-a" });
    const coord = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(coord.status).toBe("running");
  });

  it("validate ctx: routes the initial coord through runner.validate", async () => {
    f.coordRunner.validateReturnValue = { agent: "coord-a", validated: true };
    const { initialCoordNodeId, workflowId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    expect(f.coordRunner.validateCalls).toHaveLength(1);
    const v = f.coordRunner.validateCalls[0]!;
    expect(v.spec).toEqual({ agent: "coord-a" });
    expect(v.ctx.workflowId).toBe(workflowId);
    expect(v.ctx.workflowStatus).toBe("running");
    // The ctx must carry the coord FQN so any downstream runner can do
    // menu-membership checks. On bootstrap, createWorkflow uses
    // `args.coordinatorAgent` directly because the workflow row doesn't
    // exist yet.
    expect(v.ctx.coordinatorAgent).toBe("coord-a");
    const coord = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(coord.spec).toEqual({ agent: "coord-a", validated: true });
  });

  it("rejects an empty brief", () => {
    expect(() => f.module.createWorkflow.execute({ brief: "", coordinatorAgent: "x" })).toThrow();
  });

  it("rejects an empty coordinatorAgent", () => {
    expect(() => f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "" })).toThrow();
  });

  it("persists metadata round-trip through getWorkflow", async () => {
    const { workflowId } = (
      await f.module.createWorkflow.execute({
        brief: "x",
        coordinatorAgent: "coord-a",
        metadata: { source: "cli", tags: ["urgent", "blocking"] },
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.metadata).toEqual({ source: "cli", tags: ["urgent", "blocking"] });
  });

  it("defaults metadata to an empty object when omitted", async () => {
    const { workflowId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.metadata).toEqual({});
  });

  it("initializes startedAt to the createdAt instant (no pre-running state)", async () => {
    const { workflowId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.startedAt).toBeDefined();
    expect(wf.startedAt).toBe(wf.createdAt);
  });

  it("dispatch-failure inside createWorkflow flips initial coord to failed", async () => {
    f.coordRunner.dispatchShouldThrow = true;
    const { workflowId, initialCoordNodeId } = (
      await f.module.createWorkflow.execute({ brief: "x", coordinatorAgent: "coord-a" })
    )._unsafeUnwrap();
    const coord = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(coord.status).toBe("failed");
    expect(coord.endedAt).toBeDefined();
  });
});
