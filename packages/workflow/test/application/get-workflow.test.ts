import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService — read APIs", () => {
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
    const node = (await f.module.getNode.execute({ nodeId: initialCoordNodeId }))._unsafeUnwrap();
    expect(node.id).toBe(initialCoordNodeId);
    expect(node.workflowId).toBe(workflowId);
    expect(node.kind).toBe("coordinator");
  });

  it("getNode throws WorkflowNodeNotFoundError on a missing id", async () => {
    const r = await f.module.getNode.execute({ nodeId: VALID_UUIDS[15]! });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("getDag returns the workflow header + nodes + edges as a snapshot", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Add one task node child of the coord so the DAG has both
    // node kinds and one edge.
    const { nodeId: taskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.workflow.id).toBe(workflowId);
    expect(dag.nodes.map((n) => n.id).sort()).toEqual([initialCoordNodeId, taskId].sort());
    expect(dag.edges).toHaveLength(1);
    expect(dag.edges[0]?.from).toBe(initialCoordNodeId);
    expect(dag.edges[0]?.to).toBe(taskId);
  });

  it("getDag throws WorkflowNotFoundError on a missing id", async () => {
    const r = await f.module.getDag.execute({ workflowId: MISSING_WORKFLOW_ID });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });
});
