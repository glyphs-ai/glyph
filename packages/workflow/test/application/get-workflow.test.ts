import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowModule — read APIs", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  it("getWorkflow returns the persisted entity by id", async () => {
    const { workflowId } = await bootstrap(f);
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.id).toBe(workflowId);
    expect(wf.status).toBe("running");
    expect(wf.coordinatorAgent).toBe("coord-agent");
  });

  it("getWorkflow throws WorkflowNotFoundError on a missing id", async () => {
    const r = await f.module.getWorkflow.execute({ workflowId: MISSING_WORKFLOW_ID });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("getNode returns the persisted entity by id", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const node = (
      await f.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
    )._unsafeUnwrap();
    expect(node.id).toBe(initialCoordNodeId);
    expect(node.workflowId).toBe(workflowId);
    expect(node.kind).toBe("coordinator");
  });

  it("getNode throws WorkflowNodeNotFoundError on a missing id", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.getNode.execute({ workflowId, nodeId: VALID_UUIDS[15]! });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("getNode returns WorkflowNodeNotFound when the node belongs to another workflow", async () => {
    const { workflowId: firstWorkflowId } = await bootstrap(f);
    const { initialCoordNodeId } = (
      await f.module.createWorkflow.execute({
        brief: "other",
        coordinatorAgent: "coord-other",
      })
    )._unsafeUnwrap();

    const r = await f.module.getNode.execute({
      workflowId: firstWorkflowId,
      nodeId: initialCoordNodeId,
    });

    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("getDag returns the workflow header + nodes + edges as a snapshot", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds, coordId } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "task", spec: { agent: "writer", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const taskId = workerIds.task!;
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.workflow.id).toBe(workflowId);
    expect(dag.nodes.map((n) => n.id).sort()).toEqual([initialCoordNodeId, taskId, coordId].sort());
    expect(dag.edges).toHaveLength(3);
    const edgeSet = new Set(dag.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has(`${initialCoordNodeId}->${taskId}`)).toBe(true);
    expect(edgeSet.has(`${initialCoordNodeId}->${coordId}`)).toBe(true);
    expect(edgeSet.has(`${taskId}->${coordId}`)).toBe(true);
  });

  it("getDag throws WorkflowNotFoundError on a missing id", async () => {
    const r = await f.module.getDag.execute({ workflowId: MISSING_WORKFLOW_ID });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });
});
