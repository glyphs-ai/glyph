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

import type { CreateScheduleResponse, ScheduleModule } from "@glyphs-ai/schedule";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { schedulesRoutes } from "../../src/routes/schedules.js";

// biome-ignore lint/suspicious/noExplicitAny: transport tests assert on dynamically-shaped JSON bodies
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

const sampleWorkflowSchedule: CreateScheduleResponse = {
  id: "sched-wf" as CreateScheduleResponse["id"],
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

function stubUseCase<T>(response: T) {
  return { execute: vi.fn(() => okAsync(response)) };
}

function stubModule(overrides: Partial<Record<keyof ScheduleModule, unknown>>): ScheduleModule {
  const stub: Partial<Record<keyof ScheduleModule, unknown>> = {
    createSchedule: stubUseCase(sampleWorkflowSchedule),
    patchSchedule: stubUseCase(sampleWorkflowSchedule),
    ...overrides,
  };
  return stub as unknown as ScheduleModule;
}

const validTarget = {
  coordinatorAgent: "official/engineer",
  brief: "Run the nightly release workflow",
  details: "Coordinate build, test, and publish across worker agents.",
};

describe("schedulesRoutes — create workflow", () => {
  it("POST /workflow creates and returns 201 (flat workflow wire shape)", async () => {
    const create = vi.fn(() => okAsync(sampleWorkflowSchedule));
    const svc = stubModule({ createSchedule: { execute: create } });
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
    const body = await jsonBody(res);
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
    const svc = stubModule({});
    const res = await schedulesRoutes(() => svc).request("/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: validTarget, trigger: sampleWorkflowSchedule.trigger }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/name/);
    expect(svc.createSchedule.execute).not.toHaveBeenCalled();
  });

  it("POST /workflow rejects target.kind in body (URL discriminates)", async () => {
    const svc = stubModule({});
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
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/kind/);
    expect(svc.createSchedule.execute).not.toHaveBeenCalled();
  });

  it("POST /workflow with missing coordinatorAgent returns 400", async () => {
    const svc = stubModule({});
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
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/coordinatorAgent/);
    expect(svc.createSchedule.execute).not.toHaveBeenCalled();
  });

  it("POST /workflow with unknown nested target key returns 400", async () => {
    const svc = stubModule({});
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
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/surprise|unknown key/);
  });

  it("POST /workflow with a multi-line brief returns 400", async () => {
    const svc = stubModule({});
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
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/single line/);
  });
});

describe("schedulesRoutes — patch workflow", () => {
  it("PATCH /workflow/:sid forwards a sparse target with expectedKind: 'workflow'", async () => {
    const patch = vi.fn(() => okAsync(sampleWorkflowSchedule));
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { coordinatorAgent: "acme/coord" } }),
    });
    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith({
      id: "sched-wf",
      target: { patch: { coordinatorAgent: "acme/coord" } },
      expectedKind: "workflow",
    });
  });

  it("PATCH /workflow/:sid clears details via RFC 7396 null", async () => {
    const patch = vi.fn(() => okAsync(sampleWorkflowSchedule));
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { details: null } }),
    });
    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith({
      id: "sched-wf",
      target: { patch: { details: null } },
      expectedKind: "workflow",
    });
  });

  it("PATCH /workflow/:sid rejects null on the required coordinatorAgent (400)", async () => {
    const svc = stubModule({});
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { coordinatorAgent: null } }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/coordinatorAgent/);
    expect(svc.patchSchedule.execute).not.toHaveBeenCalled();
  });

  it("PATCH /workflow/:sid maps ScheduleNotFoundError → 404", async () => {
    const patch = vi.fn(() => errAsync({ type: "ScheduleNotFound", id: "sched-wf" }));
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });

  it("PATCH /workflow/:sid maps ScheduleKindMismatchError → 404 with a plain not-found envelope (no kind leak)", async () => {
    // Patching a TASK schedule via the /workflow URL must look like an
    // ordinary 404 — never reveal the resource's real kind.
    const patch = vi.fn(() =>
      errAsync({
        type: "ScheduleKindMismatch",
        id: "sched-wf",
        expected: "workflow",
        actual: "task",
      }),
    );
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesRoutes(() => svc).request("/workflow/sched-wf", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.code).toBe("ScheduleNotFound");
    expect(JSON.stringify(body)).not.toMatch(/SCHEDULE_KIND_MISMATCH|task/i);
  });
});
