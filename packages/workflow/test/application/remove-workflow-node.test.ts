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

describe("WorkflowService.removeNode", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── Happy paths ─────────────────────────────────────────

  it("removes a leaf worker-kind node and clears its adjacency", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: leaf } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "leaf" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (await f.module.removeNode.execute({ workflowId, nodeId: leaf }))._unsafeUnwrap();
    const missing = await f.module.getNode.execute({ nodeId: leaf });
    expect(missing.isErr()).toBe(true);
    expect(missing._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.map((n) => n.id)).not.toContain(leaf);
    expect(dag.edges.some((e) => e.from === leaf || e.to === leaf)).toBe(false);
  });

  it("removes a middle-of-chain node and decreases descendant phase by 1", async () => {
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
        parents: [b],
      })
    )._unsafeUnwrap();
    // Need to preserve b having a parent after a's removal: attach
    // b to coord too. Then remove a; b loses one parent (a), keeps
    // coord; c is downstream of b so its phase should shrink.
    (
      await f.module.addEdge.execute({ workflowId, fromNodeId: initialCoordNodeId, toNodeId: b })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(2);
    expect((await f.module.getNode.execute({ nodeId: c }))._unsafeUnwrap().phase).toBe(3);
    (await f.module.removeNode.execute({ workflowId, nodeId: a }))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(1);
    expect((await f.module.getNode.execute({ nodeId: c }))._unsafeUnwrap().phase).toBe(2);
  });

  it("recomputes phases convergently when removal yields multi-seed overlapping subtrees", async () => {
    // This covers BFS convergence for multi-seed
    // `recomputePhasesInTx`. `addEdge` has a one-seed test already;
    // `removeNode` of a parent with 2+ children is the canonical
    // multi-seed trigger, and the shared descendant subtree stresses
    // the convergence path.
    const { workflowId, initialCoordNodeId: coord } = await bootstrap(f);
    // Shape:
    //   coord ──→ M ──→ A ──→ D
    //         │       \ /    ↑
    //         │        X     │
    //         │       / \    │
    //         └──→ B ──→ E ──┘  (D and E both have parents {A, B})
    //
    // Phases pre-removal: coord=0, M=1, A=2, B=2, D=3, E=3.
    const { nodeId: m } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "m" },
        parents: [coord],
      })
    )._unsafeUnwrap();
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [coord, m],
      })
    )._unsafeUnwrap();
    const { nodeId: b } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "b" },
        parents: [coord, m],
      })
    )._unsafeUnwrap();
    const { nodeId: d } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "d" },
        parents: [a, b],
      })
    )._unsafeUnwrap();
    const { nodeId: e } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "e" },
        parents: [a, b],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().phase).toBe(2);
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(2);
    expect((await f.module.getNode.execute({ nodeId: d }))._unsafeUnwrap().phase).toBe(3);
    expect((await f.module.getNode.execute({ nodeId: e }))._unsafeUnwrap().phase).toBe(3);

    // Remove M. Seeds = {A, B}; both lost their M-edge. {D, E} are
    // the overlapping descendant subtree fed by both seeds — the
    // BFS-convergence path must process them once per seed without
    // double-counting, then assign the single correct phase.
    (await f.module.removeNode.execute({ workflowId, nodeId: m }))._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().phase).toBe(1);
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(1);
    expect((await f.module.getNode.execute({ nodeId: d }))._unsafeUnwrap().phase).toBe(2);
    expect((await f.module.getNode.execute({ nodeId: e }))._unsafeUnwrap().phase).toBe(2);

    // Idempotence: a second multi-seed recompute over the same
    // overlapping descendants must NOT shift phases. Trigger via
    // `addSubgraph` with a temp T that fans out to BOTH D and E and
    // whose own phase (1, as a child of coord) matches the existing
    // max-parent-phase of {D, E}. Multi-seed recompute runs over
    // {D, E}; the new max-parent-phase is still 1 → phases stable.
    (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "t",
            kind: "worker",
            spec: { agent: "w", brief: "t" },
            existingParents: [coord],
          },
          // Trailing coord temp to satisfy §3 invariant (leaves = {1 coord}).
          {
            tempId: "tEnd",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [coord],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "t" }, to: { kind: "existing", id: d } },
          { from: { kind: "temp", tempId: "t" }, to: { kind: "existing", id: e } },
          { from: { kind: "existing", id: d }, to: { kind: "temp", tempId: "tEnd" } },
          { from: { kind: "existing", id: e }, to: { kind: "temp", tempId: "tEnd" } },
        ],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ nodeId: a }))._unsafeUnwrap().phase).toBe(1);
    expect((await f.module.getNode.execute({ nodeId: b }))._unsafeUnwrap().phase).toBe(1);
    expect((await f.module.getNode.execute({ nodeId: d }))._unsafeUnwrap().phase).toBe(2);
    expect((await f.module.getNode.execute({ nodeId: e }))._unsafeUnwrap().phase).toBe(2);
  });

  it("removes all adjacent edges (incoming + outgoing) in the same tx", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: a } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "a" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    const { nodeId: middle } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "m" },
        parents: [initialCoordNodeId, a],
      })
    )._unsafeUnwrap();
    const { nodeId: child } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "c" },
        parents: [middle, a],
      })
    )._unsafeUnwrap();
    // child has two parents (middle + a). After removing middle,
    // child should retain `a` as a parent and no edges should refer
    // to middle.
    (await f.module.removeNode.execute({ workflowId, nodeId: middle }))._unsafeUnwrap();
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.edges.some((e) => e.from === middle || e.to === middle)).toBe(false);
    const childAfter = (await f.module.getNode.execute({ nodeId: child }))._unsafeUnwrap();
    expect(childAfter.id).toBe(child);
  });

  // ─── Sad paths ───────────────────────────────────────────

  it("REJECTS when status is not `not_started`", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    setNodeLifecycle(f, {
      id: nodeId,
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.removeNode.execute({ workflowId, nodeId });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  it("REJECTS when removal would orphan a child", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId: parent } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "p" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "child" },
        parents: [parent],
      })
    )._unsafeUnwrap();
    const r = await f.module.removeNode.execute({ workflowId, nodeId: parent });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("RemoveNodeOrphansChild");
  });

  it("throws WorkflowNodeNotFoundError on a missing target node", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.removeNode.execute({ workflowId, nodeId: VALID_UUIDS[15]! });
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
    const r = await f.module.removeNode.execute({ workflowId, nodeId: otherTask });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotFound");
  });

  // ─── Workflow lifecycle gate ─────────────────────────────

  it("REJECTS when workflowId does not exist", async () => {
    await bootstrap(f);
    const r = await f.module.removeNode.execute({
      workflowId: MISSING_WORKFLOW_ID,
      nodeId: VALID_UUIDS[14]!,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("REJECTS when workflow is terminal (cancel race)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { nodeId } = (
      await f.module.addNode.execute({
        workflowId,
        kind: "worker",
        spec: { agent: "w", brief: "x" },
        parents: [initialCoordNodeId],
      })
    )._unsafeUnwrap();
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.removeNode.execute({ workflowId, nodeId });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});
