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

describe("WorkflowService.addSubgraph", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── Happy paths ─────────────────────────────────────────

  it("inserts a 2-node worker chain rooted at the caller", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "t-a",
            kind: "worker",
            spec: { agent: "w", brief: "a" },
            existingParents: [initialCoordNodeId],
          },
          {
            tempId: "t-b",
            kind: "worker",
            spec: { agent: "w", brief: "b" },
            existingParents: [],
          },
          // Trailing coord temp keeps the final leaf frontier to exactly
          // one coord.
          {
            tempId: "t-end",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "t-a" }, to: { kind: "temp", tempId: "t-b" } },
          { from: { kind: "temp", tempId: "t-b" }, to: { kind: "temp", tempId: "t-end" } },
        ],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(3);
    const tA = res.insertedNodes.find((n) => n.tempId === "t-a")!;
    const tB = res.insertedNodes.find((n) => n.tempId === "t-b")!;
    const tEnd = res.insertedNodes.find((n) => n.tempId === "t-end")!;
    expect(tA.phase).toBe(1);
    expect(tB.phase).toBe(2);
    // Verify the persisted DAG matches.
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.map((n) => n.id).sort()).toEqual(
      [initialCoordNodeId, tA.nodeId, tB.nodeId, tEnd.nodeId].sort(),
    );
    const edgeSet = new Set(dag.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has(`${initialCoordNodeId}->${tA.nodeId}`)).toBe(true);
    expect(edgeSet.has(`${tA.nodeId}->${tB.nodeId}`)).toBe(true);
  });

  it("inserts a 5-node DAG with mixed existing + intra-batch parents", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // First land an existing worker root that some temps can attach
    // to as an existingParent.
    const { workerIds, coordId: existingCoord } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "root", spec: { agent: "w", brief: "root" } }],
      coordSpec: { agent: "coord-root" },
    });
    const existingRoot = workerIds.root!;
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "t1",
            kind: "worker",
            spec: { agent: "w", brief: "1" },
            existingParents: [existingRoot],
          },
          {
            tempId: "t2",
            kind: "worker",
            spec: { agent: "w", brief: "2" },
            existingParents: [existingRoot],
          },
          {
            tempId: "t3",
            kind: "worker",
            spec: { agent: "w", brief: "3" },
            existingParents: [],
          },
          {
            tempId: "t4",
            kind: "worker",
            spec: { agent: "w", brief: "4" },
            existingParents: [],
          },
          {
            tempId: "t5",
            kind: "worker",
            spec: { agent: "w", brief: "5" },
            existingParents: [],
          },
          // Trailing coord temp keeps the final leaf frontier to exactly
          // one coord.
          {
            tempId: "t-end",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [existingCoord],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "t1" }, to: { kind: "temp", tempId: "t3" } },
          { from: { kind: "temp", tempId: "t2" }, to: { kind: "temp", tempId: "t3" } },
          { from: { kind: "temp", tempId: "t3" }, to: { kind: "temp", tempId: "t4" } },
          { from: { kind: "temp", tempId: "t3" }, to: { kind: "temp", tempId: "t5" } },
          { from: { kind: "temp", tempId: "t4" }, to: { kind: "temp", tempId: "t-end" } },
          { from: { kind: "temp", tempId: "t5" }, to: { kind: "temp", tempId: "t-end" } },
        ],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(6);
    const byTemp = new Map(res.insertedNodes.map((n) => [n.tempId, n]));
    // existingRoot is phase 1 (child of coord at phase 0). t1/t2
    // attach to it → phase 2. t3 attaches to t1 and t2 → phase 3.
    // t4 and t5 attach to t3 → phase 4.
    expect(byTemp.get("t1")!.phase).toBe(2);
    expect(byTemp.get("t2")!.phase).toBe(2);
    expect(byTemp.get("t3")!.phase).toBe(3);
    expect(byTemp.get("t4")!.phase).toBe(4);
    expect(byTemp.get("t5")!.phase).toBe(4);
  });

  it("inserts a coord temp child of the caller and refreshes the denorm", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "next-coord",
            kind: "coordinator",
            spec: { agent: "coord-v2" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(1);
    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.coordinatorAgent).toBe("coord-v2");
  });

  it("recomputes phase on existing not_started to-nodes that gain a temp parent", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Existing chain: coord(0) → w1(1) → w2(2) → coord(3).
    const seeded = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "w1",
            kind: "worker",
            spec: { agent: "w", brief: "w1" },
            existingParents: [initialCoordNodeId],
          },
          {
            tempId: "w2",
            kind: "worker",
            spec: { agent: "w", brief: "w2" },
            existingParents: [],
          },
          {
            tempId: "coord",
            kind: "coordinator",
            spec: { agent: "coord-next" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "w1" }, to: { kind: "temp", tempId: "w2" } },
          { from: { kind: "temp", tempId: "w2" }, to: { kind: "temp", tempId: "coord" } },
        ],
      })
    )._unsafeUnwrap();
    const w1 = seeded.insertedNodes.find((node) => node.tempId === "w1")!.nodeId;
    const w2 = seeded.insertedNodes.find((node) => node.tempId === "w2")!.nodeId;
    const coord = seeded.insertedNodes.find((node) => node.tempId === "coord")!.nodeId;
    expect((await f.module.getNode.execute({ workflowId, nodeId: w2 }))._unsafeUnwrap().phase).toBe(
      2,
    );
    // Add a new temp parent below w1, then connect that temp into w2.
    // w2 now has parents {w1, tDeep}; tDeep has phase
    // w1.phase + 1 = 2, so w2 grows to phase 3.
    (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "tDeep",
            kind: "worker",
            spec: { agent: "w", brief: "deep" },
            existingParents: [w1],
          },
          // Trailing coord temp keeps the final leaf frontier to exactly
          // one coord.
          {
            tempId: "tEnd",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [coord],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "tDeep" }, to: { kind: "existing", id: w2 } },
          { from: { kind: "existing", id: w2 }, to: { kind: "temp", tempId: "tEnd" } },
        ],
      })
    )._unsafeUnwrap();
    expect((await f.module.getNode.execute({ workflowId, nodeId: w2 }))._unsafeUnwrap().phase).toBe(
      3,
    );
  });

  // ─── Sad paths: shape validation ─────────────────────────

  it("REJECTS empty nodes array", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({ workflowId, nodes: [], edges: [] });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "empty" },
    });
  });

  it("REJECTS duplicate tempIds", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "dup",
          kind: "worker",
          spec: { agent: "w", brief: "a" },
          existingParents: [initialCoordNodeId],
        },
        {
          tempId: "dup",
          kind: "worker",
          spec: { agent: "w", brief: "b" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "tempIdInvalid" },
    });
  });

  it("REJECTS empty-string tempId", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "",
          kind: "worker",
          spec: { agent: "w", brief: "a" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "tempIdInvalid" },
    });
  });

  it("REJECTS a parentless temp", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "lonely",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "tempParentless" },
    });
  });

  it("REJECTS an edge that references an undeclared temp", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "a",
          kind: "worker",
          spec: { agent: "w", brief: "a" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [{ from: { kind: "temp", tempId: "a" }, to: { kind: "temp", tempId: "ghost" } }],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "nodeRefUnresolved" },
    });
  });

  it("REJECTS more than one coord temp", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "c1",
          kind: "coordinator",
          spec: { agent: "coord-1" },
          existingParents: [initialCoordNodeId],
        },
        {
          tempId: "c2",
          kind: "coordinator",
          spec: { agent: "coord-2" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "multipleCoordTemps" },
    });
  });

  it("REJECTS an intra-batch cycle", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "a",
          kind: "worker",
          spec: { agent: "w", brief: "a" },
          existingParents: [initialCoordNodeId],
        },
        {
          tempId: "b",
          kind: "worker",
          spec: { agent: "w", brief: "b" },
          existingParents: [],
        },
      ],
      edges: [
        { from: { kind: "temp", tempId: "a" }, to: { kind: "temp", tempId: "b" } },
        { from: { kind: "temp", tempId: "b" }, to: { kind: "temp", tempId: "a" } },
      ],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "cyclic" },
    });
  });

  it("REJECTS a joined-DAG cycle via an existing edge", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Existing: coord → a → b → coord.
    const seeded = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "a",
            kind: "worker",
            spec: { agent: "w", brief: "a" },
            existingParents: [initialCoordNodeId],
          },
          {
            tempId: "b",
            kind: "worker",
            spec: { agent: "w", brief: "b" },
            existingParents: [],
          },
          {
            tempId: "coord",
            kind: "coordinator",
            spec: { agent: "coord-next" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [
          { from: { kind: "temp", tempId: "a" }, to: { kind: "temp", tempId: "b" } },
          { from: { kind: "temp", tempId: "b" }, to: { kind: "temp", tempId: "coord" } },
        ],
      })
    )._unsafeUnwrap();
    const a = seeded.insertedNodes.find((node) => node.tempId === "a")!.nodeId;
    const b = seeded.insertedNodes.find((node) => node.tempId === "b")!.nodeId;
    // Batch: insert temp t with parent = b, and edge t → a. That
    // closes a cycle a → b → t → a.
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "t" },
          existingParents: [b],
        },
      ],
      edges: [{ from: { kind: "temp", tempId: "t" }, to: { kind: "existing", id: a } }],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "cyclic" },
    });
  });

  // ─── Sad paths: existing-ref resolution ──────────────────

  it("REJECTS an unresolved existing-ref parent", async () => {
    const { workflowId } = await bootstrap(f);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [VALID_UUIDS[15]!],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "nodeRefUnresolved" },
    });
  });

  it("rejects an unresolved existingParents ref before calling runner.validate", async () => {
    const { workflowId } = await bootstrap(f);
    // Bootstrap only invokes the coord runner's validate; the worker
    // runner is untouched. Snapshot the worker spy at 0 so any leak
    // into the per-temp runner.validate loop is visible.
    expect(f.workerRunner.validateCalls.length).toBe(0);
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [VALID_UUIDS[15]!],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "nodeRefUnresolved" },
    });
    // The unresolved existingParents ref is caught structurally, before the
    // per-temp runner.validate loop — so the worker runner is never invoked.
    expect(f.workerRunner.validateCalls.length).toBe(0);
  });

  it("REJECTS a cross-workflow existing-ref", async () => {
    const { workflowId } = await bootstrap(f);
    const { workflowId: otherWorkflowId, initialCoordNodeId: otherCoord } = (
      await f.module.createWorkflow.execute({
        brief: "other",
        coordinatorAgent: "coord-z",
      })
    )._unsafeUnwrap();
    const { workerIds } = await addIteration(f, {
      workflowId: otherWorkflowId,
      parentCoordId: otherCoord,
      nodes: [{ tempId: "remote", spec: { agent: "w", brief: "remote" } }],
      coordSpec: { agent: "coord-other-next" },
    });
    const otherTask = workerIds.remote!;
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [otherTask],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "nodeRefUnresolved" },
    });
  });

  it("REJECTS when an existing to-node is not not_started", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "target", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const target = workerIds.target!;
    setNodeLifecycle(f, {
      id: target,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "t" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [{ from: { kind: "temp", tempId: "t" }, to: { kind: "existing", id: target } }],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNodeNotMutable");
  });

  // ─── Happy paths: input normalization ────────────────────

  it("dedupes duplicate existingParents within a temp", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Caller passes the same parent ref three times. The substrate
    // must silently collapse to a single edge rather than
    // surfacing a composite-PK violation as a generic SQLite error.
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "t",
            kind: "worker",
            spec: { agent: "w", brief: "x" },
            existingParents: [initialCoordNodeId, initialCoordNodeId, initialCoordNodeId],
          },
          // Trailing coord temp keeps the final leaf frontier to exactly
          // one coord.
          {
            tempId: "t-end",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [{ from: { kind: "temp", tempId: "t" }, to: { kind: "temp", tempId: "t-end" } }],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(2);
    const t = res.insertedNodes.find((n) => n.tempId === "t")!;
    expect(t.phase).toBe(1);
    // Exactly one edge from coord → t (dedup collapsed the triple).
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const incoming = dag.edges.filter((e) => e.to === t.nodeId);
    expect(incoming.length).toBe(1);
    expect(incoming[0]!.from).toBe(initialCoordNodeId);
  });

  it("dedupes duplicate edges entries by (from, to) identity", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "a",
            kind: "worker",
            spec: { agent: "w", brief: "a" },
            existingParents: [initialCoordNodeId],
          },
          {
            tempId: "b",
            kind: "worker",
            spec: { agent: "w", brief: "b" },
            existingParents: [],
          },
          // Trailing coord temp keeps the final leaf frontier to exactly
          // one coord.
          {
            tempId: "t-end",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [initialCoordNodeId],
          },
        ],
        // Same (from, to) pair declared twice — collapse to one edge.
        edges: [
          { from: { kind: "temp", tempId: "a" }, to: { kind: "temp", tempId: "b" } },
          { from: { kind: "temp", tempId: "a" }, to: { kind: "temp", tempId: "b" } },
          { from: { kind: "temp", tempId: "b" }, to: { kind: "temp", tempId: "t-end" } },
        ],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(3);
    const aNode = res.insertedNodes.find((n) => n.tempId === "a")!;
    const bNode = res.insertedNodes.find((n) => n.tempId === "b")!;
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const aToBs = dag.edges.filter((e) => e.from === aNode.nodeId && e.to === bNode.nodeId);
    expect(aToBs.length).toBe(1);
  });

  // ─── Sad paths: parent-state and coord-chain rules ───────

  it("REJECTS a worker temp with a `failed` existing parent", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "dead", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const deadParent = workerIds.dead!;
    setNodeLifecycle(f, {
      id: deadParent,
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "t" },
          existingParents: [deadParent],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowDagConflict",
      reason: { kind: "parentState" },
    });
  });

  it("REJECTS a coord temp without a coord parent", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const { workerIds } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "worker", spec: { agent: "w", brief: "x" } }],
      coordSpec: { agent: "coord-next" },
    });
    const someWorker = workerIds.worker!;
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "c",
          kind: "coordinator",
          spec: { agent: "coord-v2" },
          existingParents: [someWorker],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowDagConflict",
      reason: { kind: "orphanCoordInsert" },
    });
  });

  it("REJECTS a coord temp when its coord parent already has a coord-kind child", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    // Pre-existing coord child of the caller.
    (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "coord-pre",
            kind: "coordinator",
            spec: { agent: "coord-pre" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [],
      })
    )._unsafeUnwrap();
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "c",
          kind: "coordinator",
          spec: { agent: "coord-batch" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowDagConflict",
      reason: { kind: "successorCoordExists" },
    });
  });

  it("REJECTS when runner.validate throws", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    f.workerRunner.validateShouldThrow = new Error("bad temp spec");
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("NodeSpecError");
    expect(r._unsafeUnwrapErr()).toMatchObject({ reason: "bad temp spec" });
  });

  // ─── Workflow lifecycle gate ─────────────────────────────

  it("REJECTS when workflow is terminal (cancel race)", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.addSubgraph.execute({
      workflowId,
      nodes: [
        {
          tempId: "t",
          kind: "worker",
          spec: { agent: "w", brief: "x" },
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});
