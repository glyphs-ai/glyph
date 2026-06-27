/**
 * Route-level tests for `routes/scheduled-workflows.ts`. Sibling of
 * `scheduled-tasks.test.ts` — same stub pattern, same vitest layout.
 * The route is read-only (a single `GET /` handler) so the assertion
 * surface is small; it covers:
 *
 *   - origin pinning (only workflows with `metadata.scheduleId` set)
 *   - the optional `?scheduleId=` narrow
 *   - createdAt-desc order preserved through the projection
 *   - the entity→wire projection: every row carries the REQUIRED
 *     `awaitingHumanCount` field (the regression this route's earlier
 *     raw `c.json(entities)` shape omitted)
 */

import { WorkflowEntity, type WorkflowService } from "@glyphs-ai/workflow";
import { describe, expect, it, vi } from "vitest";
import { scheduledWorkflowsRoutes } from "../../src/routes/scheduled-workflows.js";

// Valid workflow ids — `<YYYYMMDD>-<8 lowercase hex>`. `fromRow` rejects
// anything else, so fixtures must use the real grammar.
const WF_A = "20260601-0000000a";
const WF_B = "20260601-0000000b";
const WF_NEWEST = "20260603-0000000d";
const WF_MID = "20260602-0000000e";
const WF_OLDEST = "20260601-0000000f";

function makeWf(
  id: string,
  opts: { scheduleId?: string; status?: string; createdAt?: string } = {},
): WorkflowEntity {
  return WorkflowEntity.fromRow({
    id,
    brief: `brief ${id}`,
    details: null,
    coordinatorAgent: "official/engineer",
    status: (opts.status ?? "running") as never,
    origin: opts.scheduleId !== undefined ? "schedule" : "standalone",
    originId: opts.scheduleId ?? null,
    metadata: "{}",
    createdAt: opts.createdAt ?? "2026-06-01T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    success: null,
    failure: null,
    cancellation: null,
  });
}

function stubService(
  overrides: Partial<Record<keyof WorkflowService, unknown>> = {},
): WorkflowService {
  const stub: Partial<Record<keyof WorkflowService, unknown>> = {
    list: vi.fn(async () => []),
    countAwaitingHumanByWorkflow: vi.fn(async () => new Map()),
    ...overrides,
  };
  return stub as unknown as WorkflowService;
}

describe("scheduledWorkflowsRoutes", () => {
  it("GET / returns schedule-origin workflows via origin filter", async () => {
    // The route passes `{ origin: "schedule" }` to the service; the
    // service returns only schedule-origin rows. The route applies no
    // additional origin filtering — that responsibility is delegated.
    const list = vi.fn(async () => [
      makeWf(WF_A, { scheduleId: "sched-abc" }),
      makeWf(WF_B, { scheduleId: "sched-xyz" }),
    ]);
    const svc = stubService({ list });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_A, WF_B]);
    expect(list).toHaveBeenCalledWith({ origin: "schedule" });
  });

  it("GET /?scheduleId=<id> narrows via the typed origin_id column", async () => {
    const list = vi.fn(async () => [makeWf(WF_A, { scheduleId: "sched-abc" })]);
    const svc = stubService({ list });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/?scheduleId=sched-abc");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_A]);
    expect(list).toHaveBeenCalledWith({ origin: "schedule", originId: "sched-abc" });
  });

  it("projects every row to the wire header — REQUIRED awaitingHumanCount is always present", async () => {
    const list = vi.fn(async () => [
      makeWf(WF_A, { scheduleId: "sched-abc" }),
      makeWf(WF_B, { scheduleId: "sched-abc" }),
    ]);
    const countAwaitingHumanByWorkflow = vi.fn(async () => new Map([[WF_A, 2]]));
    const svc = stubService({ list, countAwaitingHumanByWorkflow });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    // wf-a got an explicit count; wf-b defaults to 0 — never undefined.
    expect(body[0].awaitingHumanCount).toBe(2);
    expect(body[1].awaitingHumanCount).toBe(0);
    for (const row of body) {
      expect(Object.hasOwn(row, "awaitingHumanCount")).toBe(true);
    }
  });

  it("does NOT leak raw entity-only fields not on the wire header (allowlist projection)", async () => {
    const list = vi.fn(async () => [makeWf(WF_A, { scheduleId: "sched-abc" })]);
    const svc = stubService({ list });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await res.json();
    // `iterationCount` is intentionally omitted on list rows (O(workflows)).
    expect(Object.hasOwn(body[0], "iterationCount")).toBe(false);
    // Header essentials present.
    expect(body[0].id).toBe(WF_A);
    expect(body[0].coordinatorAgent).toBe("official/engineer");
    expect(body[0].status).toBe("running");
  });

  it("preserves the repository's createdAt-desc order through the projection", async () => {
    const list = vi.fn(async () => [
      makeWf(WF_NEWEST, { scheduleId: "s", createdAt: "2026-06-03T00:00:00.000Z" }),
      makeWf(WF_MID, { scheduleId: "s", createdAt: "2026-06-02T00:00:00.000Z" }),
      makeWf(WF_OLDEST, { scheduleId: "s", createdAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    const svc = stubService({ list });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await res.json();
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_NEWEST, WF_MID, WF_OLDEST]);
  });

  it("returns [] when no workflows were launched by a schedule", async () => {
    const list = vi.fn(async () => []);
    const svc = stubService({ list });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
