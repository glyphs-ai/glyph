import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("WorkflowService.removeEdge", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── Happy paths ─────────────────────────────────────────

  it("removes a redundant edge between two existing nodes", async () => {
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
        parents: [initialCoordNodeId, a],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(2);
    (await f.module.removeEdge.execute({ workflowId, fromNodeId: a, toNodeId: b }))._unsafeUnwrap();
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.edges.some((e) => e.from === a && e.to === b)).toBe(false);
    // After removing the a→b edge, b's parents = [initialCoordNode]
    // only, so phase shrinks to coord.phase + 1 = 1.
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(1);
  });

  it("no-op recompute: removing a non-longest-path edge leaves phases unchanged", async () => {
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
        parents: [a],
      })
    )._unsafeUnwrap();
    const { nodeId: c } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "c" },
        parents: [initialCoordNodeId, b],
      })
    )._unsafeUnwrap();
    // c has parents [coord (phase 0), b (phase 2)] so c.phase = 3.
    expect((await f.module.getNode.execute({ nodeId: c }))._unsafeUnwrap().phase).toBe(3);
    // Remove coord→c (the shorter path). c retains b as a parent
    // and phase remains 3.
    (
      await f.module.removeEdge.execute({
        workflowId,
        fromNodeId: initialCoordNodeId,
        toNodeId: c,
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: c }))._unsafeUnwrap().phase).toBe(3);
  });

  // ─── Sad paths ───────────────────────────────────────────

  it("REJECTS when to-node status != not_started", async () => {
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
        parents: [initialCoordNodeId, a],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: b,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.removeEdge.execute({ workflowId, fromNodeId: a, toNodeId: b });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("REJECTS when to-node would lose its last parent", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: child } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "child" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const r = await f.module.removeEdge.execute({
      workflowId,
      fromNodeId: initialCoordNodeId,
      toNodeId: child,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("RemoveEdgeOrphansChild");
  });

  it("throws WorkflowEdgeNotFoundError when the edge does not exist", async () => {
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
    // No a→b edge exists.
    const r = await f.module.removeEdge.execute({ workflowId, fromNodeId: a, toNodeId: b });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowEdgeNotFound");
  });

  it("throws WorkflowNodeNotFoundError when endpoints are missing", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.removeEdge.execute({
      workflowId,
      fromNodeId: VALID_UUIDS[14]!,
      toNodeId: VALID_UUIDS[15]!,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  it("REJECTS cross-workflow endpoints", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
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
    const r = await f.module.removeEdge.execute({
      workflowId,
      fromNodeId: initialCoordNodeId,
      toNodeId: otherTask,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  // ─── Workflow lifecycle gate ─────────────────────────────

  it("REJECTS when workflowId does not exist", async () => {
    await bootstrap(f);
    const r = await f.module.removeEdge.execute({
      workflowId: MISSING_WORKFLOW_ID,
      fromNodeId: VALID_UUIDS[13]!,
      toNodeId: VALID_UUIDS[14]!,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("REJECTS when workflow is terminal", async () => {
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
        parents: [initialCoordNodeId, a],
      })
    )._unsafeUnwrap();
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.removeEdge.execute({ workflowId, fromNodeId: a, toNodeId: b });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});
