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
  "550e8400-e29b-41d4-a716-44665544000a",
].map((u) => WorkflowNodeIdSchema.parse(u));
const [C0, W1, W2, PRIOR, CR] = IDS as [
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
  WorkflowNodeId,
];

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
    specVersion: 0,
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
    specVersion: 0,
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

describe("stuck-recovery counting — interleaving", () => {
  it("resets the coord_exited chain to attempt=1 after a workers_finished wake-up", () => {
    // Most-recent terminal coord is a workers_finished retry coord (attempt=1),
    // still running as the sole leaf; terminating it empty opens a coord_exited
    // chain that must start fresh — not pre-charged by the wake-up's attempt=1.
    const wf = reconstituteRunning(
      [
        coord(C0, 0, { status: "succeeded" }),
        worker(W1, "succeeded"),
        coord(CR, 2, { status: "running", attempt: 1, reason: "workers_finished_without_coord" }),
      ],
      [edge(C0, W1), edge(W1, CR)],
    );

    const res = wf.markNodeTerminal(CR, "succeeded", LATER)._unsafeUnwrap();

    expect(res.workflowFailed).toBe(false);
    expect(res.retryCoordInserted).not.toBeNull();
    const retry = wf.nodes.find((n) => n.id === res.retryCoordInserted);
    // attempt=1 (would be 2 if the workers_finished predecessor pre-charged it).
    expect(extractWorkflowNodeRetryMetadata(retry?.metadata ?? {})).toMatchObject({
      reason: "coord_exited_without_action",
      attempt: 1,
    });
  });

  it("gives the following coord_exited chain a full retry budget before capping", () => {
    const wf = reconstituteRunning(
      [
        coord(C0, 0, { status: "succeeded" }),
        worker(W1, "succeeded"),
        coord(CR, 2, { status: "running", attempt: 1, reason: "workers_finished_without_coord" }),
      ],
      [edge(C0, W1), edge(W1, CR)],
    );

    // Drive the coord_exited chain: each empty coord exit inserts the next retry
    // coord (the new sole leaf), which we terminate in turn until the cap trips.
    const coordExitedAttempts: number[] = [];
    let next: WorkflowNodeId | null = CR;
    let failed = false;
    let minute = 1;
    while (next !== null && !failed) {
      const current: WorkflowNodeId = next;
      const at = `2026-07-07T00:${String(minute).padStart(2, "0")}:00.000Z`;
      minute += 1;
      const res = wf.markNodeTerminal(current, "succeeded", at)._unsafeUnwrap();
      failed = res.workflowFailed;
      if (res.retryCoordInserted !== null) {
        const inserted = wf.nodes.find((n) => n.id === res.retryCoordInserted);
        const meta = extractWorkflowNodeRetryMetadata(inserted?.metadata ?? {});
        if (meta?.reason === "coord_exited_without_action") coordExitedAttempts.push(meta.attempt);
      }
      next = res.retryCoordInserted;
    }

    expect(failed).toBe(true);
    expect(wf.status).toBe("failed");
    // A full budget of STUCK_RETRY_MAX_ATTEMPTS coord_exited retries preceded the
    // cap; the workers_finished wake-up cost the chain nothing (it would be one
    // fewer if the wake-up pre-charged the ratchet).
    expect(coordExitedAttempts).toEqual(
      Array.from({ length: STUCK_RETRY_MAX_ATTEMPTS }, (_, i) => i + 1),
    );
  });
});
