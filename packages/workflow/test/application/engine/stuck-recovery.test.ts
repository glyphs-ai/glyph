/**
 * Tests for the substrate's stuck-coord recovery.
 *
 * The recovery mechanism has two observable surfaces:
 *
 *  1. The mutation primitives fire an in-tx detector at commit time;
 *     when a workflow is in a quiescent stuck state (status=running,
 *     every node terminal, leaves form one of the stuck shapes) the
 *     detector inserts a retry coord node and the wrapping write
 *     post-commit dispatches it.
 *  2. `addSubgraph` rejects batches whose final leaf frontier is not
 *     exactly `{1 coordinator}` with `WorkflowDagInvariantError` so
 *     callers can never push a workflow into a structurally-stuck
 *     shape in a single primitive.
 *
 * Tests below mirror §15 of the design (15.1–15.11). These tests
 * drive the detector via natural mutations (e.g. `markNodeTerminal`
 * on the last worker leaf) rather than calling a public
 * `recoverStuck` entry-point — the substrate does not expose one;
 * recovery is automatic.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractWorkflowNodeRetryMetadata } from "../../../src/domain/node/workflow-node-retry.js";
import { STUCK_RETRY_MAX_ATTEMPTS } from "../../../src/domain/workflow/workflow-stuck-recovery.js";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "../workflow-fixture.js";

async function markNodeTerminal(
  f: WorkflowFixture,
  args: {
    readonly workflowId: Awaited<ReturnType<typeof bootstrap>>["workflowId"];
    readonly nodeId: Awaited<ReturnType<typeof bootstrap>>["initialCoordNodeId"];
    readonly status: "succeeded" | "failed" | "cancelled";
    readonly reason?: string;
  },
): Promise<void> {
  f.setNow(new Date(f.nowRef.value.getTime() + 1000));
  (
    await f.module.engine.markNodeTerminal(
      args.workflowId,
      args.nodeId,
      args.status === "succeeded"
        ? { status: "succeeded" }
        : args.status === "failed"
          ? { status: "failed", reason: args.reason ?? "test failure" }
          : { status: "cancelled", reason: args.reason ?? "test cancellation" },
    )
  )._unsafeUnwrap();
}

async function quietEngine(f: WorkflowFixture): Promise<void> {
  await f.module.engine.drain();
}

describe("WorkflowService — stuck-coord recovery", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });

  afterEach(async () => {
    await f.close();
  });

  // ─── 15.1 — addSubgraph commit-time leaf-frontier invariant ────────

  it("§15.1 addSubgraph rejects a batch that yields worker-only leaves", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
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
    expect(r._unsafeUnwrapErr().type).toBe("DagInvariant");
  });

  it("§15.1 addSubgraph rejects a batch that yields two leaves", async () => {
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
          existingParents: [initialCoordNodeId],
        },
      ],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("DagInvariant");
  });

  it("§15.1 addSubgraph accepts a batch whose final leaves are {1 coord}", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const res = (
      await f.module.addSubgraph.execute({
        workflowId,
        nodes: [
          {
            tempId: "w",
            kind: "worker",
            spec: { agent: "w", brief: "x" },
            existingParents: [initialCoordNodeId],
          },
          {
            tempId: "c",
            kind: "coordinator",
            spec: { agent: "coord-end" },
            existingParents: [initialCoordNodeId],
          },
        ],
        edges: [{ from: { kind: "temp", tempId: "w" }, to: { kind: "temp", tempId: "c" } }],
      })
    )._unsafeUnwrap();
    expect(res.insertedNodes.length).toBe(2);
  });

  // ─── 15.2 — Stuck detector Case (a) coord_exited_without_action ────

  it("§15.2 detector inserts retry coord (reason=coord_exited_without_action) when coord terminates with no children", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // Terminal coord with no children → the in-tx detector fires
    // from inside `markNodeTerminal` itself and inserts a retry coord
    // before the wrapping primitive returns.
    await markNodeTerminal(f, { workflowId, nodeId: initialCoordNodeId, status: "succeeded" });
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    // 2 nodes now: the prev coord + the inserted retry coord.
    expect(dag.nodes.length).toBe(2);
    const retry = dag.nodes.find((n) => n.id !== initialCoordNodeId);
    expect(retry).toBeDefined();
    expect(retry?.kind).toBe("coordinator");
    // After the post-commit dispatch the stub coord runner records
    // the call and returns; the node may be `not_started`, `ready`,
    // or `running` depending on whether the engine's nudge has fired
    // through dispatchAtomic yet. None of the terminal statuses are
    // possible at this point.
    expect(retry?.status).not.toBe("succeeded");
    expect(retry?.status).not.toBe("failed");
    expect(retry?.status).not.toBe("cancelled");
    const meta = extractWorkflowNodeRetryMetadata(retry!.metadata);
    expect(meta).toEqual({
      of: initialCoordNodeId,
      reason: "coord_exited_without_action",
      attempt: 1,
    });
    // Retry coord is a child of the prev coord (so the
    // OrphanCoordInsertError invariant is satisfied).
    expect(dag.edges.some((e) => e.from === initialCoordNodeId && e.to === retry?.id)).toBe(true);
  });

  // ─── 15.3 — Stuck detector Case (b) workers_finished_without_coord ─

  it("§15.3 valid worker completion does not trigger workers_finished_without_coord", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    const { workerIds, coordId } = await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [
        { tempId: "w1", spec: { agent: "w", brief: "w1" } },
        { tempId: "w2", spec: { agent: "w", brief: "w2" } },
      ],
      coordSpec: { agent: "coord-next" },
    });
    const w1 = workerIds.w1!;
    const w2 = workerIds.w2!;
    await markNodeTerminal(f, { workflowId, nodeId: initialCoordNodeId, status: "succeeded" });
    await markNodeTerminal(f, { workflowId, nodeId: w1, status: "succeeded" });
    await markNodeTerminal(f, { workflowId, nodeId: w2, status: "succeeded" });
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(
      dag.nodes
        .filter((n) => n.kind === "coordinator")
        .map((n) => n.id)
        .sort(),
    ).toEqual([initialCoordNodeId, coordId].sort());
  });

  // ─── 15.4 — Attempt counter ratchets across recoveries ─────────────

  it("§15.4 attempt counter increments across multiple recoveries", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // 1st recovery: prev coord exits empty → retry coord attempt=1.
    await markNodeTerminal(f, { workflowId, nodeId: initialCoordNodeId, status: "succeeded" });
    let dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const retry1 = dag.nodes.find((n) => n.id !== initialCoordNodeId);
    expect(extractWorkflowNodeRetryMetadata(retry1!.metadata)?.attempt).toBe(1);
    // 2nd recovery: retry1 exits empty → retry coord attempt=2.
    await markNodeTerminal(f, { workflowId, nodeId: retry1!.id, status: "succeeded" });
    dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const retry2 = dag.nodes.find((n) => n.id !== initialCoordNodeId && n.id !== retry1?.id);
    expect(extractWorkflowNodeRetryMetadata(retry2!.metadata)?.attempt).toBe(2);
    // 3rd recovery: retry2 exits empty → retry coord attempt=3.
    await markNodeTerminal(f, { workflowId, nodeId: retry2!.id, status: "succeeded" });
    dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    const retry3 = dag.nodes.find(
      (n) => n.id !== initialCoordNodeId && n.id !== retry1?.id && n.id !== retry2?.id,
    );
    expect(extractWorkflowNodeRetryMetadata(retry3!.metadata)?.attempt).toBe(3);
  });

  // ─── 15.5 — Detector is a no-op when the workflow still has live work ─

  it("§15.5 addSubgraph fires the detector on a fresh workflow with a running coord and inserts no retry", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "noise", spec: { agent: "w", brief: "noise" } }],
      coordSpec: { agent: "coord-next" },
    });
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.length).toBe(3);
    expect(dag.nodes.filter((n) => n.kind === "coordinator").length).toBe(2);
  });

  // ─── 15.6 — cancelWorkflow is not a detector trigger site ──────────

  it("§15.6 cancelWorkflow does not trigger the detector even when the resulting DAG looks stuck", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // Cancel reconciles the only coord to `cancelled`. The post-cancel
    // DAG is structurally stuck-looking (workflow now terminal,
    // single-coord leaf) but cancelWorkflow is intentionally NOT one
    // of the §13 detector trigger sites — finishWorkflow /
    // cancelWorkflow / reconcileCancel flip the workflow terminal in
    // the same tx, and the detector's `status === 'running'` check
    // would always be false anyway.
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    // No retry coord was inserted; only the original (cancelled) coord
    // remains.
    expect(dag.nodes.length).toBe(1);
    expect(dag.nodes[0]!.id).toBe(initialCoordNodeId);
    expect(dag.nodes[0]!.status).toBe("cancelled");
  });

  // ─── 15.7 — Detector skips workflows with non-terminal nodes ───────

  it("§15.7 detector skips when any node is still not_started / ready / running", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await addIteration(f, {
      workflowId,
      parentCoordId: initialCoordNodeId,
      nodes: [{ tempId: "pending", spec: { agent: "w", brief: "pending" } }],
      coordSpec: { agent: "coord-next" },
    });
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.length).toBe(3);
    expect(dag.nodes.filter((n) => n.kind === "coordinator").length).toBe(2);
  });

  // ─── 15.8 — Detector is idempotent under repeated mutation firings ─

  it("§15.8 a second detector firing while the retry coord is non-terminal does not insert a duplicate", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // 1st firing — markNodeTerminal on the initial coord (a §13
    // trigger site) inserts a retry coord at commit time.
    await markNodeTerminal(f, { workflowId, nodeId: initialCoordNodeId, status: "succeeded" });
    const dag1 = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag1.nodes.length).toBe(2);
    const retry = dag1.nodes.find((n) => n.id !== initialCoordNodeId);
    expect(retry).toBeDefined();
    expect(retry?.kind).toBe("coordinator");
    await addIteration(f, {
      workflowId,
      parentCoordId: retry!.id,
      nodes: [{ tempId: "post-retry", spec: { agent: "w", brief: "post-retry" } }],
      coordSpec: { agent: "coord-next" },
    });
    const dag2 = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag2.nodes.length).toBe(4);
    expect(dag2.nodes.filter((n) => n.kind === "coordinator").length).toBe(3);
  });

  // ─── 15.10 — Workflow denorm `coordinator_agent` mirrors retry coord ─

  it("§15.10 retry-coord insertion refreshes workflows.coordinator_agent denorm", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f, {
      coordinatorAgent: "coord-v1",
    });
    await quietEngine(f);
    expect(
      (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap().coordinatorAgent,
    ).toBe("coord-v1");
    // Drive to stuck and trigger explicit recovery.
    await markNodeTerminal(f, { workflowId, nodeId: initialCoordNodeId, status: "succeeded" });
    // Substrate copies prev coord's agent verbatim into the retry
    // coord's spec, then refreshes the denorm to match.
    expect(
      (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap().coordinatorAgent,
    ).toBe("coord-v1");
  });

  // ─── 15.11 — Retry attempt cap (defensive safety net) ──────────────

  it("§15.11 detector stops inserting retry coords after STUCK_RETRY_MAX_ATTEMPTS", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // Drive 5 successful retry-coord insertions: terminate the
    // initial coord, then each retry, in sequence. Each terminal is
    // a natural mutation (markNodeTerminal — a §13 detector trigger
    // site) so this exercises the production code path end-to-end
    // without any test-only entry points.
    let prevId = initialCoordNodeId;
    for (let i = 1; i <= STUCK_RETRY_MAX_ATTEMPTS; i++) {
      await markNodeTerminal(f, { workflowId, nodeId: prevId, status: "succeeded" });
      const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
      // Pick the newest coord (the one whose retry.attempt matches i).
      const next = dag.nodes.find((n) => {
        const meta = extractWorkflowNodeRetryMetadata(n.metadata);
        return meta !== undefined && meta.attempt === i;
      });
      expect(next).toBeDefined();
      prevId = next!.id;
    }
    // 6th terminal: the detector hits the cap and inserts no new
    // retry coord. The DAG node count stays at
    // STUCK_RETRY_MAX_ATTEMPTS + 1 (initial + 5 retries).
    await markNodeTerminal(f, { workflowId, nodeId: prevId, status: "succeeded" });
    const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
    expect(dag.nodes.length).toBe(STUCK_RETRY_MAX_ATTEMPTS + 1);
  });

  it("§15.12 detector transitions the workflow to failed with STUCK_RETRY_LIMIT reason when the cap is exceeded", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    await quietEngine(f);
    // Same 5-retry setup as §15.11, driven via natural
    // `markNodeTerminal` mutations.
    let prevId = initialCoordNodeId;
    for (let i = 1; i <= STUCK_RETRY_MAX_ATTEMPTS; i++) {
      await markNodeTerminal(f, { workflowId, nodeId: prevId, status: "succeeded" });
      const dag = (await f.module.getDag.execute({ workflowId }))._unsafeUnwrap();
      const next = dag.nodes.find((n) => {
        const meta = extractWorkflowNodeRetryMetadata(n.metadata);
        return meta !== undefined && meta.attempt === i;
      });
      expect(next).toBeDefined();
      prevId = next!.id;
    }
    // Pre-6th-terminal: the workflow is still `running`.
    expect((await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap().status).toBe(
      "running",
    );
    // 6th terminal trips the cap. The detector flips the workflow
    // to `failed` inside the same mutation tx, persisting a
    // structured failure payload with `kind: 'substrate'` +
    // `reason: 'STUCK_RETRY_LIMIT'`. The transition is atomic with
    // the triggering mutation; the dashboard surfaces an
    // operator-visible failure reason on `GET /workflows/:id`.
    await markNodeTerminal(f, { workflowId, nodeId: prevId, status: "succeeded" });
    const after = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(after.status).toBe("failed");
    expect(after.failure).toBeDefined();
    if (after.failure?.kind !== "substrate") {
      throw new Error(`expected substrate failure, got ${String(after.failure?.kind)}`);
    }
    expect(after.failure.reason).toBe("STUCK_RETRY_LIMIT");
    expect(after.failure.message).toContain("STUCK_RETRY_LIMIT");
    // The endedAt timestamp is set by the same UPDATE as the status
    // flip — the cross-field invariant ("workflow terminal ⇒
    // endedAt non-null") still holds for the substrate-driven path.
    expect(after.endedAt).toBeDefined();
  });
});
