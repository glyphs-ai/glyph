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

describe("WorkflowService.addNode", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── Happy path + phase ───────────────────────────────────

  it("adds a worker-kind node and assigns phase = MAX(parents.phase) + 1", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId, phase } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // initialCoord phase = 0, so child phase = 1.
    expect(phase).toBe(1);
    const node = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(node.kind).toBe("worker");
    expect(node.phase).toBe(1);
  });

  it("threads validate ctx with the workflow id and status", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Drain createWorkflow's validate call so we can assert on the
    // next one.
    f.coordRunner.validateCalls.length = 0;
    f.workerRunner.validateCalls.length = 0;
    (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    expect(f.workerRunner.validateCalls).toHaveLength(1);
    const v = f.workerRunner.validateCalls[0]!;
    expect(v.ctx.workflowId).toBe(workflowId);
    expect(v.ctx.workflowStatus).toBe("running");
    // Post-bootstrap mutations read the workflow row and propagate
    // its denormalized `coordinator_agent` into the runner ctx.
    // `bootstrap()` defaults the coord FQN to "coord-agent" — the
    // substrate must echo that here regardless of which kind of node
    // we're adding.
    expect(v.ctx.coordinatorAgent).toBe("coord-agent");
  });

  // ─── Kind-aware parent-state restriction ─────────────────

  it("REJECTS a worker-kind node whose parent is `failed`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Force the parent to `failed`.
    setNodeLifecycle(f, {
      id: parentId,
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "y" },
      parents: [parentId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("ParentState");
  });

  it("REJECTS a worker-kind node whose parent is `cancelled`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentId,
      status: "cancelled",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "y" },
      parents: [parentId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("ParentState");
  });

  it("ALLOWS a coordinator-kind node whose parent is `failed` (coord wakes on failure)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentId,
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    // The new coord's parents must include the caller (orphan-coord
    // rule), so attach both the failed task AND the caller.
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-b" },
        parents: [initialCoordNodeId, parentId],
      })
    )._unsafeUnwrap();
    const node = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(node.kind).toBe("coordinator");
  });

  // ─── Coord-kind structural rules ─────────────────────────

  it("REJECTS a coord-kind insert that does NOT list the caller as a parent (orphan)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: peerTaskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "coordinator",
      spec: { agent: "coord-b" },
      parents: [peerTaskId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("OrphanCoordInsert");
  });

  it("REJECTS a coord-kind insert when the caller already has a coord-kind child", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "coordinator",
      spec: { agent: "coord-c" },
      parents: [initialCoordNodeId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("MultipleSuccessorCoords");
  });

  it("denorm invariant: coord-kind insert updates `workflows.coordinator_agent` atomically with the INSERT", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    (
      await f.module.addNode.execute({
        workflowId,
        kind: "coordinator",
        spec: { agent: "coord-b" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.coordinatorAgent).toBe("coord-b");
  });

  // ─── Auth gate derived from workflowId ───────────────────

  it("REJECTS when workflowId does not exist", async () => {
    await bootstrap(f);
    const r = await f.module.addNode.execute({
      workflowId: MISSING_WORKFLOW_ID,
      kind: "worker",
      spec: { agent: "x", brief: "y" },
      parents: [VALID_UUIDS[14]!],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("REJECTS when the workflow is already terminal (cancelled)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "x" },
      parents: [initialCoordNodeId],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });

  it("REJECTS when a parent id refers to a node in a different workflow", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Bootstrap a second workflow with its own coord; try to attach
    // a node in `workflowId` to a parent in the OTHER workflow.
    const { initialCoordNodeId: otherCoord } = (
      await f.module.createWorkflow.execute({
        brief: "other",
        coordinatorAgent: "coord-x",
      })
    )._unsafeUnwrap();
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "x" },
      parents: [initialCoordNodeId, otherCoord],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  // ─── Closed-kind enum ─────────────────────────────────────
  //
  // The substrate's `AddNodeOpts.kind` field is typed `WorkflowNodeKind`
  // (`'coordinator' | 'worker'`). Inserting an unknown kind is a
  // TypeScript compile error rather than a runtime throw — see
  // `public-api-guard.test.ts` for the type-level assertion. No
  // runtime test is needed because the bad path is unreachable
  // through the typed surface.

  it("throws WorkflowNodeNotFoundError when a parent id does not exist", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "x" },
      parents: [VALID_UUIDS[15]!],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  // ─── Eager dispatch reaction ─────────────────────────────

  it("eager dispatch: fires `dispatchAtomic` when the new task's parents are all already `succeeded`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parentTaskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentTaskId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    f.workerRunner.dispatchCalls.length = 0;
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "child" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await f.module.engine.drain();
    // The eager-dispatch reaction must fire — otherwise the child
    // would sit in not_started forever (no future parent-termination
    // event will arrive in this PR's substrate).
    const child = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(child.status).toBe("running");
    expect(f.workerRunner.dispatchCalls.map((c) => c.nodeId)).toContain(nodeId);
  });

  it("eager dispatch: does NOT fire when parents are still running", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const parent = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    // Leave parent in not_started (because its parent coord is still
    // running, parent task never satisfied the readiness predicate).
    expect((await f.module.getNode.execute({ nodeId: parent.nodeId }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    f.workerRunner.dispatchCalls.length = 0;
    const child = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "c" },
        parents: [parent.nodeId],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: child.nodeId }))._unsafeUnwrap().status).toBe(
      "not_started",
    );
    expect(f.workerRunner.dispatchCalls.map((c) => c.nodeId)).not.toContain(child.nodeId);
  });

  it("eager dispatch: when all parents are already terminal, dispatches immediately", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Materialise a parent task and force it terminal so the new
    // task's parent-readiness predicate is satisfied at insert time.
    const { nodeId: parentTaskId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: parentTaskId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    f.workerRunner.dispatchCalls.length = 0;
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "writer", brief: "child" },
        parents: [parentTaskId],
      })
    )._unsafeUnwrap();
    await f.module.engine.drain();
    const n = (await f.module.getNode.execute({ nodeId }))._unsafeUnwrap();
    expect(n.status).toBe("running");
    expect(f.workerRunner.dispatchCalls.map((c) => c.nodeId)).toContain(nodeId);
  });

  it("REJECTS when parents is empty", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addNode.execute({
      workflowId,
      kind: "worker",
      spec: { agent: "writer", brief: "x" },
      parents: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("EmptyParents");
  });
});
