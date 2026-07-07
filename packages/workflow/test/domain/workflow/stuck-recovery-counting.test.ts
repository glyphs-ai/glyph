import { describe, expect, it } from "vitest";
import { WorkflowEdgeEntity } from "../../../src/domain/edge/workflow-edge-entity.js";
import { WorkflowNodeEntity } from "../../../src/domain/node/workflow-node-entity.js";
import {
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";
import { extractWorkflowNodeRetryMetadata } from "../../../src/domain/node/workflow-node-retry.js";
import { WorkflowBriefSchema } from "../../../src/domain/workflow/workflow-brief.js";
import { WorkflowEntity } from "../../../src/domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";
import { STUCK_RETRY_MAX_ATTEMPTS } from "../../../src/domain/workflow/workflow-stuck-recovery.js";

/**
 * Entity-level tests for the stuck-recovery counting asymmetry: only
 * `coord_exited_without_action` accrues toward the retry cap;
 * `workers_finished_without_coord` always resets to `attempt = 1` and never
 * caps. The module-level §15 suite already covers the coord-exited ratchet and
 * cap on the natural mutation path; these tests pin the branch directly by
 * reconstituting a graph whose previous coord already sits at the cap.
 */

const WF_ID = WorkflowIdSchema.parse("20260707-00000002");
const NOW = "2026-07-07T00:00:00.000Z";
const LATER = "2026-07-07T00:01:00.000Z";

const IDS = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440009",
].map((u) => WorkflowNodeIdSchema.parse(u));
const [C0, W1, W2, PRIOR] = IDS as [WorkflowNodeId, WorkflowNodeId, WorkflowNodeId, WorkflowNodeId];

function reconstituteRunning(
  nodes: readonly WorkflowNodeEntity[],
  edges: readonly WorkflowEdgeEntity[],
): WorkflowEntity {
  return WorkflowEntity.reconstitute({
    id: WF_ID,
    brief: WorkflowBriefSchema.parse("counting-test"),
    details: undefined,
    coordinatorAgent: "c",
    status: "running",
    origin: "standalone",
    originId: undefined,
    metadata: {},
    createdAt: NOW,
    startedAt: NOW,
    endedAt: undefined,
    success: undefined,
    failure: undefined,
    cancellation: undefined,
    nodes,
    edges,
  });
}

function coord(
  id: WorkflowNodeId,
  phase: number,
  opts: {
    readonly status: "succeeded" | "running";
    readonly attempt?: number;
    readonly reason?: "coord_exited_without_action" | "workers_finished_without_coord";
  },
): WorkflowNodeEntity {
  const metadata =
    opts.attempt !== undefined
      ? {
          retry: {
            of: PRIOR,
            reason: opts.reason ?? "coord_exited_without_action",
            attempt: opts.attempt,
          },
        }
      : {};
  return WorkflowNodeEntity.reconstitute({
    id,
    workflowId: WF_ID,
    kind: "coordinator",
    spec: { agent: "c" },
    phase,
    status: opts.status,
    metadata,
    createdAt: NOW,
    readyAt: undefined,
    runningAt: undefined,
    endedAt: opts.status === "succeeded" ? NOW : undefined,
  });
}

function worker(id: WorkflowNodeId, status: "succeeded" | "running"): WorkflowNodeEntity {
  return WorkflowNodeEntity.reconstitute({
    id,
    workflowId: WF_ID,
    kind: "worker",
    spec: { agent: "w", brief: "b" },
    phase: 1,
    status,
    metadata: {},
    createdAt: NOW,
    readyAt: undefined,
    runningAt: undefined,
    endedAt: status === "succeeded" ? NOW : undefined,
  });
}

function edge(from: WorkflowNodeId, to: WorkflowNodeId): WorkflowEdgeEntity {
  return WorkflowEdgeEntity.reconstitute({ workflowId: WF_ID, from, to });
}

describe("stuck-recovery counting — workers_finished_without_coord", () => {
  it("resets to attempt=1 and never caps even when the prev coord is already at the cap", () => {
    // C0 at the cap (attempt=5), two workers as the surviving frontier.
    const wf = reconstituteRunning(
      [
        coord(C0, 0, { status: "succeeded", attempt: STUCK_RETRY_MAX_ATTEMPTS }),
        worker(W1, "succeeded"),
        worker(W2, "running"),
      ],
      [edge(C0, W1), edge(C0, W2)],
    );

    const res = wf.markNodeTerminal(W2, "succeeded", LATER)._unsafeUnwrap();

    // Not capped: a fresh retry coord is inserted, workflow stays running.
    expect(res.workflowFailed).toBe(false);
    expect(res.retryCoordInserted).not.toBeNull();
    expect(wf.status).toBe("running");
    const retry = wf.nodes.find((n) => n.id === res.retryCoordInserted);
    expect(retry?.kind).toBe("coordinator");
    expect(extractWorkflowNodeRetryMetadata(retry?.metadata ?? {})).toEqual({
      of: C0,
      reason: "workers_finished_without_coord",
      attempt: 1,
    });
  });
});

describe("stuck-recovery counting — coord_exited_without_action", () => {
  it("still accrues toward the cap and fails the workflow when exceeded", () => {
    // Single coord already at the cap; exiting empty pushes attempt past it.
    const wf = reconstituteRunning(
      [coord(C0, 0, { status: "running", attempt: STUCK_RETRY_MAX_ATTEMPTS })],
      [],
    );

    const res = wf.markNodeTerminal(C0, "succeeded", LATER)._unsafeUnwrap();

    expect(res.workflowFailed).toBe(true);
    expect(res.retryCoordInserted).toBeNull();
    expect(wf.status).toBe("failed");
    const failure = wf.failure;
    expect(failure?.kind).toBe("substrate");
    if (failure?.kind !== "substrate") throw new Error("unreachable");
    expect(failure.reason).toBe("STUCK_RETRY_LIMIT");
  });
});
