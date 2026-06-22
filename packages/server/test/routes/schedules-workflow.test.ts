/**
 * Route-level tests for the workflow-kind verbs on `routes/schedules.ts`
 * (`POST /schedules/workflow`, `PATCH /schedules/workflow/:sid`).
 * Sibling of `schedules.test.ts`, which covers the task-kind verbs; this
 * file isolates the workflow surface added for scheduled workflows.
 *
 * Coverage:
 *   - POST /workflow happy path → 201 with the flat workflow wire shape
 *     + the `{ kind: "workflow", data }` envelope handed to the service
 *   - POST /workflow input validation 400s (name, target.kind in body,
 *     unknown nested key, missing coordinatorAgent, multi-line brief)
 *   - PATCH /workflow/:sid sparse target forward with
 *     `expectedKind: "workflow"`
 *   - PATCH /workflow/:sid clear-details (RFC 7396 null) + reject null
 *     on required coordinatorAgent
 *   - cross-kind guard: `ScheduleKindMismatchError` → 404 with a plain
 *     not-found envelope (no kind leak)
 */

import {
  type Schedule,
  ScheduleKindMismatchError,
  ScheduleNotFoundError,
  type ScheduleService,
} from "@glyphs-ai/schedule";
import { describe, expect, it, vi } from "vitest";
import { schedulesRoutes } from "../../src/routes/schedules.js";

const sampleWorkflowSchedule: Schedule = {
  id: "sched-wf",
  name: "Nightly release workflow",
  target: {
    kind: "workflow",
    data: {
      coordinatorAgent: "official/engineer",
      brief: "Run the nightly release workflow",
      details: "Coordinate build, test, and publish across worker agents.",
    },
  },
  trigger: { kind: "cron", expr: "0 2 * * *", tz: "Asia/Shanghai" },
  enabled: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function stubService(overrides: Partial<Record<keyof ScheduleService, unknown>>): ScheduleService {
  const stub: Partial<Record<keyof ScheduleService, unknown>> = {
    create: vi.fn(async () => sampleWorkflowSchedule),
    patch: vi.fn(async () => sampleWorkflowSchedule),
    ...overrides,
  };
  return stub as unknown as ScheduleService;
}

const validTarget = {
  coordinatorAgent: "official/engineer",
  brief: "Run the nightly release workflow",
  details: "Coordinate build, test, and publish across worker agents.",
};

describe("schedulesRoutes — create workflow", () => {
  it("POST /workflow creates and returns 201 (flat workflow wire shape)", async () => {
    const create = vi.fn(async () => sampleWorkflowSchedule);
    const svc = stubService({ create });
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nightly release workflow",
        target: validTarget,
        trigger: sampleWorkflowSchedule.trigger,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.target).toEqual({ kind: "workflow", ...validTarget });
    expect(create).toHaveBeenCalledTimes(1);
    // Service receives the internal `{ kind, data }` envelope.
    expect(create).toHaveBeenCalledWith({
      name: "Nightly release workflow",
      target: { kind: "workflow", data: validTarget },
      trigger: sampleWorkflowSchedule.trigger,
    });
  });

  it("POST /workflow with missing name returns 400", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: validTarget, trigger: sampleWorkflowSchedule.trigger }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("POST /workflow rejects target.kind in body (URL discriminates)", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x",
        target: { kind: "workflow", ...validTarget },
        trigger: sampleWorkflowSchedule.trigger,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/kind/);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("POST /workflow with missing coordinatorAgent returns 400", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x",
        target: { brief: "do x" },
        trigger: sampleWorkflowSchedule.trigger,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/coordinatorAgent/);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("POST /workflow with unknown nested target key returns 400", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x",
        target: { ...validTarget, surprise: 1 },
        trigger: sampleWorkflowSchedule.trigger,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/surprise|unknown key/);
  });

  it("POST /workflow with a multi-line brief returns 400", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x",
        target: { coordinatorAgent: "official/engineer", brief: "line1\nline2" },
        trigger: sampleWorkflowSchedule.trigger,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/single line/);
  });
});

describe("schedulesRoutes — patch workflow", () => {
  it("PATCH /workflow/:sid forwards a sparse target with expectedKind: 'workflow'", async () => {
    const patch = vi.fn(async () => sampleWorkflowSchedule);
    const svc = stubService({ patch });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { coordinatorAgent: "acme/coord" } }),
    });
    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith("sched-wf", {
      target: { patch: { coordinatorAgent: "acme/coord" } },
      expectedKind: "workflow",
    });
  });

  it("PATCH /workflow/:sid clears details via RFC 7396 null", async () => {
    const patch = vi.fn(async () => sampleWorkflowSchedule);
    const svc = stubService({ patch });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { details: null } }),
    });
    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith("sched-wf", {
      target: { patch: { details: null } },
      expectedKind: "workflow",
    });
  });

  it("PATCH /workflow/:sid rejects null on the required coordinatorAgent (400)", async () => {
    const svc = stubService({});
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { coordinatorAgent: null } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/coordinatorAgent/);
    expect(svc.patch).not.toHaveBeenCalled();
  });

  it("PATCH /workflow/:sid maps ScheduleNotFoundError → 404", async () => {
    const patch = vi.fn(async () => {
      throw new ScheduleNotFoundError("sched-wf");
    });
    const svc = stubService({ patch });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("ScheduleNotFoundError");
  });

  it("PATCH /workflow/:sid maps ScheduleKindMismatchError → 404 with a plain not-found envelope (no kind leak)", async () => {
    // Patching a TASK schedule via the /workflow URL must look like an
    // ordinary 404 — never reveal the resource's real kind.
    const patch = vi.fn(async () => {
      throw new ScheduleKindMismatchError("sched-wf", "workflow", "task");
    });
    const svc = stubService({ patch });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("ScheduleNotFoundError");
    expect(JSON.stringify(body)).not.toMatch(/SCHEDULE_KIND_MISMATCH|task/i);
  });
});
