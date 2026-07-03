/**
 * Route-level tests for `routes/scheduled-workflows.ts`. Sibling of
 * `scheduled-tasks.test.ts` — same stub pattern, same vitest layout.
 * The route is read-only (a single `GET /` handler) so the assertion
 * surface is small; it covers:
 *
 *   - origin pinning (only workflows with `origin === "schedule"`)
 *   - the optional `?scheduleId=` narrow
 *   - createdAt-desc order preserved through the projection
 *   - the view→wire projection: every row carries the REQUIRED
 *     `awaitingHumanCount` field (the regression this route's earlier
 *     raw `c.json(entities)` shape omitted)
 */

import type { GetWorkflowResponse, WorkflowModule } from "@glyphs-ai/workflow";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { scheduledWorkflowsRoutes } from "../../src/routes/scheduled-workflows.js";

// biome-ignore lint/suspicious/noExplicitAny: transport tests assert on dynamically-shaped JSON bodies
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

// Valid workflow ids — `<YYYYMMDD>-<8 lowercase hex>`. The list use-case
// returns already-validated views, so fixtures use the real grammar.
const WF_A = "20260601-0000000a";
const WF_B = "20260601-0000000b";
const WF_NEWEST = "20260603-0000000d";
const WF_MID = "20260602-0000000e";
const WF_OLDEST = "20260601-0000000f";

function makeWf(
  id: string,
  opts: { scheduleId?: string; status?: string; createdAt?: string } = {},
): GetWorkflowResponse {
  return {
    id: id as GetWorkflowResponse["id"],
    brief: `brief ${id}`,
    coordinatorAgent: "official/engineer",
    status: (opts.status ?? "running") as GetWorkflowResponse["status"],
    origin: opts.scheduleId !== undefined ? "schedule" : "standalone",
    ...(opts.scheduleId !== undefined ? { originId: opts.scheduleId } : {}),
    metadata: {},
    createdAt: opts.createdAt ?? "2026-06-01T00:00:00.000Z",
  };
}

// Stub the two use-cases the route consumes. Each is a `{ execute }`
// container returning a `ResultAsync`; `listWorkflows` yields views and
// `countAwaitingHuman` yields the origin→count Record the route folds
// into a Map. Callers override the `execute` mocks they assert on.
function stubModule(
  overrides: {
    listWorkflows?: { execute: ReturnType<typeof vi.fn> };
    countAwaitingHuman?: { execute: ReturnType<typeof vi.fn> };
  } = {},
): WorkflowModule {
  const stub = {
    listWorkflows: overrides.listWorkflows ?? { execute: vi.fn(() => okAsync([])) },
    countAwaitingHuman: overrides.countAwaitingHuman ?? { execute: vi.fn(() => okAsync({})) },
  };
  return stub as unknown as WorkflowModule;
}

describe("scheduledWorkflowsRoutes", () => {
  it("GET / returns schedule-origin workflows via origin filter", async () => {
    // The route passes `{ origin: "schedule" }` to the use-case; the
    // use-case returns only schedule-origin rows. The route applies no
    // additional origin filtering — that responsibility is delegated.
    const listWorkflows = {
      execute: vi.fn(() =>
        okAsync([
          makeWf(WF_A, { scheduleId: "sched-abc" }),
          makeWf(WF_B, { scheduleId: "sched-xyz" }),
        ]),
      ),
    };
    const svc = stubModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_A, WF_B]);
    expect(listWorkflows.execute).toHaveBeenCalledWith({ origin: "schedule" });
  });

  it("GET /?scheduleId=<id> narrows via the typed origin_id column", async () => {
    const listWorkflows = {
      execute: vi.fn(() => okAsync([makeWf(WF_A, { scheduleId: "sched-abc" })])),
    };
    const svc = stubModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/?scheduleId=sched-abc");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_A]);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "sched-abc",
    });
  });

  it("projects every row to the wire header — REQUIRED awaitingHumanCount is always present", async () => {
    const listWorkflows = {
      execute: vi.fn(() =>
        okAsync([
          makeWf(WF_A, { scheduleId: "sched-abc" }),
          makeWf(WF_B, { scheduleId: "sched-abc" }),
        ]),
      ),
    };
    const countAwaitingHuman = { execute: vi.fn(() => okAsync({ [WF_A]: 2 })) };
    const svc = stubModule({ listWorkflows, countAwaitingHuman });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    // wf-a got an explicit count; wf-b defaults to 0 — never undefined.
    expect(body[0].awaitingHumanCount).toBe(2);
    expect(body[1].awaitingHumanCount).toBe(0);
    for (const row of body) {
      expect(Object.hasOwn(row, "awaitingHumanCount")).toBe(true);
    }
  });

  it("does NOT leak raw entity-only fields not on the wire header (allowlist projection)", async () => {
    const listWorkflows = {
      execute: vi.fn(() => okAsync([makeWf(WF_A, { scheduleId: "sched-abc" })])),
    };
    const svc = stubModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await jsonBody(res);
    // `iterationCount` is intentionally omitted on list rows (O(workflows)).
    expect(Object.hasOwn(body[0], "iterationCount")).toBe(false);
    // Header essentials present.
    expect(body[0].id).toBe(WF_A);
    expect(body[0].coordinatorAgent).toBe("official/engineer");
    expect(body[0].status).toBe("running");
  });

  it("preserves the repository's createdAt-desc order through the projection", async () => {
    const listWorkflows = {
      execute: vi.fn(() =>
        okAsync([
          makeWf(WF_NEWEST, { scheduleId: "s", createdAt: "2026-06-03T00:00:00.000Z" }),
          makeWf(WF_MID, { scheduleId: "s", createdAt: "2026-06-02T00:00:00.000Z" }),
          makeWf(WF_OLDEST, { scheduleId: "s", createdAt: "2026-06-01T00:00:00.000Z" }),
        ]),
      ),
    };
    const svc = stubModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await jsonBody(res);
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_NEWEST, WF_MID, WF_OLDEST]);
  });

  it("returns [] when no workflows were launched by a schedule", async () => {
    const listWorkflows = { execute: vi.fn(() => okAsync([])) };
    const svc = stubModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual([]);
  });
});
