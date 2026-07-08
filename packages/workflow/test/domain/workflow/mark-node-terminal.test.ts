import { describe, expect, it, vi } from "vitest";
import { WorkflowEdgeEntity } from "../../../src/domain/edge/workflow-edge-entity.js";
import { WorkflowNodeEntity } from "../../../src/domain/node/workflow-node-entity.js";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";
import { WorkflowBriefSchema } from "../../../src/domain/workflow/workflow-brief.js";
import { WorkflowEntity } from "../../../src/domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";

/**
 * `markNodeTerminal` is a write-through recording point for a runner's terminal
 * verdict, not a policy layer. A node's callback can land *after* the workflow
 * itself is already terminal — e.g. a coordinator calls `finishWorkflow` from
 * its own tick, so the workflow settles before the coord's runner-side callback
 * arrives. `node.status` ("did this runner deliver a terminal verdict?") and
 * `workflow.status` ("what did the aggregate deliver?") are independent axes, so
 * the verdict is recorded verbatim rather than rejected — with one narrow
 * exception: a late `failed` callback on a `succeeded` workflow is coerced to
 * `cancelled` (a `succeeded` workflow is the strongest external promise, and a
 * post-decision runner crash has no downstream utility). Only an already-terminal
 * node (idempotency) or an absent node (`WorkflowNodeNotFound`) short-circuits
 * the write.
 */

const WF_ID = WorkflowIdSchema.parse("20260708-0000cafe");
const CREATED = "2026-07-08T00:00:00.000Z";
const FINISHED = "2026-07-08T00:02:00.000Z";
const CALLBACK = "2026-07-08T00:03:00.000Z";

// Any valid UUIDv4 works for the coord node; this one mirrors a real occurrence.
const COORD_ID = WorkflowNodeIdSchema.parse("d130682a-b41a-43d9-a4e2-8629473031f9");
const WORKER_ID = WorkflowNodeIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");

function coord(
  id: WorkflowNodeId,
  phase: number,
  status: "running" | "succeeded",
): WorkflowNodeEntity {
  return WorkflowNodeEntity.reconstitute({
    id,
    workflowId: WF_ID,
    kind: "coordinator",
    spec: { agent: "c" },
    phase,
    status,
    metadata: {},
    createdAt: CREATED,
    readyAt: undefined,
    runningAt: CREATED,
    endedAt: status === "succeeded" ? CREATED : undefined,
  });
}

function worker(
  id: WorkflowNodeId,
  phase: number,
  status: "running" | "succeeded",
): WorkflowNodeEntity {
  return WorkflowNodeEntity.reconstitute({
    id,
    workflowId: WF_ID,
    kind: "worker",
    spec: { agent: "w", brief: "b" },
    phase,
    status,
    metadata: {},
    createdAt: CREATED,
    readyAt: undefined,
    runningAt: CREATED,
    endedAt: status === "succeeded" ? CREATED : undefined,
  });
}

function edge(from: WorkflowNodeId, to: WorkflowNodeId): WorkflowEdgeEntity {
  return WorkflowEdgeEntity.reconstitute({ workflowId: WF_ID, from, to });
}

function runningWorkflow(
  nodes: readonly WorkflowNodeEntity[],
  edges: readonly WorkflowEdgeEntity[] = [],
): WorkflowEntity {
  return WorkflowEntity.reconstitute({
    id: WF_ID,
    brief: WorkflowBriefSchema.parse("mark-node-terminal-test"),
    details: undefined,
    coordinatorAgent: "c",
    status: "running",
    origin: "standalone",
    originId: undefined,
    metadata: {},
    createdAt: CREATED,
    startedAt: CREATED,
    endedAt: undefined,
    success: undefined,
    failure: undefined,
    cancellation: undefined,
    nodes,
    edges,
  });
}

function nodeStatus(wf: WorkflowEntity, id: WorkflowNodeId): string | undefined {
  return wf.nodes.find((n) => n.id === id)?.status;
}

describe("markNodeTerminal — late callback after workflow succeeded", () => {
  it("accepts a late 'succeeded' callback for the self-finishing coordinator", () => {
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.succeed({ output: "done" }, FINISHED).isOk()).toBe(true);
    expect(wf.status).toBe("succeeded");

    const res = wf.markNodeTerminal(COORD_ID, "succeeded", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    const node = wf.nodes.find((n) => n.id === COORD_ID);
    expect(node?.status).toBe("succeeded");
    expect(node?.endedAt).toBe(CALLBACK);
    // Workflow stays succeeded; the late callback only closed the node.
    expect(wf.status).toBe("succeeded");
  });

  it("coerces a late 'failed' callback on a succeeded workflow to 'cancelled' (invariant guard)", () => {
    // A worker/coord subprocess crashing after `finishWorkflow(succeeded)` was
    // already called is post-decision runner noise; recording it verbatim would
    // leak a "failed node inside succeeded workflow" surprise to every consumer.
    // Coerce to `cancelled` — same shape reconcileCancel already uses for
    // "runner didn't deliver, workflow moved on."
    const wf = runningWorkflow(
      [coord(COORD_ID, 0, "succeeded"), worker(WORKER_ID, 1, "running")],
      [edge(COORD_ID, WORKER_ID)],
    );
    expect(wf.succeed({ output: "done" }, FINISHED).isOk()).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = wf.markNodeTerminal(WORKER_ID, "failed", CALLBACK);
      expect(res.isOk()).toBe(true);
      expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });

      // The recorded status is coerced.
      expect(nodeStatus(wf, WORKER_ID)).toBe("cancelled");
      expect(wf.nodes.find((n) => n.id === WORKER_ID)?.endedAt).toBe(CALLBACK);
      expect(wf.status).toBe("succeeded"); // workflow outcome untouched

      // Telemetry emitted with a stable shape.
      expect(warn).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(warn.mock.calls[0]?.[0] as string);
      expect(payload).toMatchObject({
        event: "workflow.markNodeTerminal.crossover_coerced",
        workflowStatus: "succeeded",
        runnerStatus: "failed",
        recordedStatus: "cancelled",
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("records a 'failed' callback on a failed workflow verbatim (crossover NOT coerced)", () => {
    const wf = runningWorkflow([worker(WORKER_ID, 0, "running")]);
    expect(wf.fail({ kind: "coordinator", message: "boom" }, FINISHED).isOk()).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = wf.markNodeTerminal(WORKER_ID, "failed", CALLBACK);
      expect(res.isOk()).toBe(true);
      expect(nodeStatus(wf, WORKER_ID)).toBe("failed");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT coerce a 'cancelled' callback on a succeeded workflow (reconcileCancel path stays exact)", () => {
    const wf = runningWorkflow(
      [coord(COORD_ID, 0, "succeeded"), worker(WORKER_ID, 1, "running")],
      [edge(COORD_ID, WORKER_ID)],
    );
    expect(wf.succeed({ output: "done" }, FINISHED).isOk()).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = wf.markNodeTerminal(WORKER_ID, "cancelled", CALLBACK);
      expect(res.isOk()).toBe(true);
      expect(nodeStatus(wf, WORKER_ID)).toBe("cancelled");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("accepts a 'cancelled' callback on a succeeded workflow (reconcileCancel orphan path)", () => {
    // finishWorkflow(succeeded) runs reconcileCancel afterward, which closes
    // orphaned not-yet-terminal nodes as "cancelled" on the succeeded workflow.
    const wf = runningWorkflow(
      [coord(COORD_ID, 0, "succeeded"), worker(WORKER_ID, 1, "running")],
      [edge(COORD_ID, WORKER_ID)],
    );
    expect(wf.succeed({ output: "done" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(WORKER_ID, "cancelled", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(nodeStatus(wf, WORKER_ID)).toBe("cancelled");
  });

  it("does not run stuck-recovery once the workflow is terminal", () => {
    // A lone succeeded coord would normally trip stuck-recovery
    // (coord_exited_without_action) and synthesise a retry coord while the
    // workflow is running; on a settled workflow nothing may be inserted.
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.succeed({ output: "done" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(COORD_ID, "succeeded", CALLBACK);

    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    // No retry coord, no new edges — structure unchanged apart from the status.
    expect(wf.nodes).toHaveLength(1);
    expect(wf.edges).toHaveLength(0);
  });
});

describe("markNodeTerminal — late callback after workflow failed", () => {
  it("accepts a late 'failed' callback for the self-finishing coordinator", () => {
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.fail({ kind: "coordinator", message: "boom" }, FINISHED).isOk()).toBe(true);
    expect(wf.status).toBe("failed");

    const res = wf.markNodeTerminal(COORD_ID, "failed", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    expect(nodeStatus(wf, COORD_ID)).toBe("failed");
    expect(wf.nodes.find((n) => n.id === COORD_ID)?.endedAt).toBe(CALLBACK);
  });

  it("accepts a late 'cancelled' callback (reconcileCancel path) after fail", () => {
    const wf = runningWorkflow(
      [coord(COORD_ID, 0, "running"), worker(WORKER_ID, 1, "running")],
      [edge(COORD_ID, WORKER_ID)],
    );
    expect(wf.fail({ kind: "coordinator", message: "boom" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(WORKER_ID, "cancelled", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(nodeStatus(wf, WORKER_ID)).toBe("cancelled");
  });

  it("records a 'succeeded' callback on a failed workflow (crossover, verbatim)", () => {
    // A coord that calls finishWorkflow(failed) from its own tick still
    // succeeded as a runner — it delivered the "workflow failed" decision.
    const wf = runningWorkflow(
      [coord(COORD_ID, 0, "running"), worker(WORKER_ID, 1, "running")],
      [edge(COORD_ID, WORKER_ID)],
    );
    expect(wf.fail({ kind: "coordinator", message: "boom" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(WORKER_ID, "succeeded", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    expect(nodeStatus(wf, WORKER_ID)).toBe("succeeded");
    expect(wf.status).toBe("failed");
  });
});

describe("markNodeTerminal — late callback after workflow cancelled", () => {
  it("records a 'succeeded' callback on a cancelled workflow (verbatim, not coerced)", () => {
    // A runner that finished cleanly before reconcileCancel walked the DAG
    // reports 'succeeded'. Record the real verdict; do not coerce to cancelled.
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.cancel({ kind: "user", message: "stop" }, FINISHED).isOk()).toBe(true);
    expect(wf.status).toBe("cancelled");

    const res = wf.markNodeTerminal(COORD_ID, "succeeded", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    expect(nodeStatus(wf, COORD_ID)).toBe("succeeded");
    expect(wf.status).toBe("cancelled");
  });

  it("records a 'failed' callback on a cancelled workflow (verbatim, not coerced)", () => {
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.cancel({ kind: "user", message: "stop" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(COORD_ID, "failed", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(nodeStatus(wf, COORD_ID)).toBe("failed");
    expect(wf.status).toBe("cancelled");
  });

  it("accepts a 'cancelled' callback on a cancelled workflow", () => {
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);
    expect(wf.cancel({ kind: "user", message: "stop" }, FINISHED).isOk()).toBe(true);

    const res = wf.markNodeTerminal(COORD_ID, "cancelled", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(nodeStatus(wf, COORD_ID)).toBe("cancelled");
  });
});

describe("markNodeTerminal — idempotency and stuck-recovery gating", () => {
  it("is idempotent: a repeat callback on an already-terminal node is an ok no-op", () => {
    const wf = runningWorkflow([coord(COORD_ID, 0, "succeeded")]);

    const res = wf.markNodeTerminal(COORD_ID, "failed", CALLBACK);

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ retryCoordInserted: null, workflowFailed: false });
    // Neither status nor endedAt moved — the first terminal verdict stands.
    expect(nodeStatus(wf, COORD_ID)).toBe("succeeded");
    expect(wf.nodes.find((n) => n.id === COORD_ID)?.endedAt).toBe(CREATED);
  });

  it("runs stuck-recovery while the workflow is still running", () => {
    // A lone coord that exits 'succeeded' without spawning work trips
    // coord_exited_without_action and synthesises a retry coordinator.
    const wf = runningWorkflow([coord(COORD_ID, 0, "running")]);

    const res = wf.markNodeTerminal(COORD_ID, "succeeded", CALLBACK);

    expect(res.isOk()).toBe(true);
    const outcome = res._unsafeUnwrap();
    expect(outcome.retryCoordInserted).not.toBeNull();
    expect(outcome.workflowFailed).toBe(false);
    expect(wf.status).toBe("running");
    expect(wf.nodes).toHaveLength(2);
  });
});
