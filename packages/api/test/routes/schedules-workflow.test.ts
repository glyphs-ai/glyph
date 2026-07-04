import type {
  CreateScheduleResponse,
  PreviewScheduleResponse,
  ScheduleModule,
} from "@glyphs-ai/schedule";
import type { WorkflowModule } from "@glyphs-ai/workflow";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { schedulesWorkflowRoutes } from "../../src/routes/schedules/scheduled-workflows.js";

// biome-ignore lint/suspicious/noExplicitAny: route tests assert dynamic JSON envelopes
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

const sampleSchedule: CreateScheduleResponse = {
  id: "sched-abc" as CreateScheduleResponse["id"],
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

const validTarget = {
  coordinatorAgent: "official/engineer",
  brief: "Run the nightly release workflow",
  details: "Coordinate build, test, and publish across worker agents.",
};

// Wire target == the stored data verbatim; `kind` is implied by the URL path.
const wireTarget = validTarget;

function stubUseCase<T>(response: T) {
  return { execute: vi.fn(() => okAsync(response)) };
}

function previewResponse(n: number): PreviewScheduleResponse {
  return {
    describe: "every day at 02:00",
    nextRuns: Array.from({ length: n }, (_, i) => `2026-06-0${i + 1}T18:00:00.000Z`),
  };
}

function stubModule(overrides: Partial<Record<keyof ScheduleModule, unknown>>): ScheduleModule {
  return {
    listSchedules: stubUseCase([sampleSchedule]),
    createSchedule: stubUseCase(sampleSchedule),
    getSchedule: stubUseCase(sampleSchedule),
    patchSchedule: stubUseCase(sampleSchedule),
    deleteSchedule: stubUseCase({ deletedDispatchCount: 0 }),
    runSchedule: stubUseCase({ dispatchId: "workflow-001" }),
    previewSchedule: {
      execute: vi.fn(({ n = 3 }: { expr: string; tz: string; n?: number }) =>
        okAsync(previewResponse(n)),
      ),
    },
    ...overrides,
  } as unknown as ScheduleModule;
}

function stubWorkflowModule(
  overrides: Partial<Record<keyof WorkflowModule, unknown>> = {},
): WorkflowModule {
  return {
    aggregateByOrigin: {
      execute: vi.fn(() =>
        okAsync({ "sched-abc": { totalCount: 1, runningCount: 1, awaitingCount: 0 } }),
      ),
    },
    ...overrides,
  } as unknown as WorkflowModule;
}

async function expectValidation400(res: Response, needle?: RegExp) {
  expect(res.status).toBe(400);
  const body = await jsonBody(res);
  expect(body.code).toBeDefined();
  if (needle) expect(JSON.stringify(body)).toMatch(needle);
  return body;
}

describe("schedulesWorkflowRoutes — list", () => {
  it("GET / returns workflow schedules with fireStats", async () => {
    const svc = stubModule({});
    const workflow = stubWorkflowModule();
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => workflow,
    ).request("/");
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual([
      {
        ...sampleSchedule,
        target: wireTarget,
        fireStats: { runningCount: 1, awaitingCount: 0 },
      },
    ]);
    expect(svc.listSchedules.execute).toHaveBeenCalledWith({ kind: "workflow" });
    expect(workflow.aggregateByOrigin.execute).toHaveBeenCalledWith({
      origin: "schedule",
      originIds: ["sched-abc"],
      statusIn: ["running"],
    });
  });

  it("GET /?coordinatorAgent=x&enabled=false maps workflow filters", async () => {
    const list = vi.fn(() => okAsync([]));
    const svc = stubModule({ listSchedules: { execute: list } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/?coordinatorAgent=official/engineer&enabled=false");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      kind: "workflow",
      dataEquals: { path: "$.coordinatorAgent", value: "official/engineer" },
      enabled: false,
    });
  });
});

describe("schedulesWorkflowRoutes — create", () => {
  it("POST / creates and returns 201 with zero fireStats", async () => {
    const create = vi.fn(() => okAsync(sampleSchedule));
    const svc = stubModule({ createSchedule: { execute: create } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sampleSchedule.name,
        target: validTarget,
        trigger: sampleSchedule.trigger,
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.target).toEqual(wireTarget);
    expect(body.fireStats).toEqual({ awaitingCount: 0, runningCount: 0 });
    expect(create).toHaveBeenCalledWith({
      name: sampleSchedule.name,
      target: { kind: "workflow", data: validTarget },
      trigger: sampleSchedule.trigger,
    });
  });

  it.each([
    ["missing name", { target: validTarget, trigger: sampleSchedule.trigger }, /name/],
    [
      "missing coordinatorAgent",
      { name: "x", target: { brief: "do x" }, trigger: sampleSchedule.trigger },
      /coordinatorAgent/,
    ],
    [
      "empty coordinatorAgent",
      {
        name: "x",
        target: { ...validTarget, coordinatorAgent: "" },
        trigger: sampleSchedule.trigger,
      },
      /coordinatorAgent/,
    ],
    [
      "unknown target key",
      { name: "x", target: { ...validTarget, extra: 1 }, trigger: sampleSchedule.trigger },
      /extra|unknown/i,
    ],
    [
      "unknown top-level key",
      { name: "x", target: validTarget, trigger: sampleSchedule.trigger, extra: 1 },
      /extra|unknown/i,
    ],
  ])("POST / rejects %s", async (_label, body, needle) => {
    const svc = stubModule({});
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await expectValidation400(res, needle);
    expect(svc.createSchedule.execute).not.toHaveBeenCalled();
  });
});

describe("schedulesWorkflowRoutes — get", () => {
  it("GET /:sid returns describe and fireStats", async () => {
    const svc = stubModule({});
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.target).toEqual(wireTarget);
    expect(body.fireStats).toEqual({ runningCount: 1, awaitingCount: 0 });
    expect(typeof body.describe).toBe("string");
    expect(svc.getSchedule.execute).toHaveBeenCalledWith({
      id: "sched-abc",
      expectedKind: "workflow",
    });
  });

  it("GET /:sid returns 404 when service returns null", async () => {
    const svc = stubModule({ getSchedule: { execute: vi.fn(() => okAsync(null)) } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/missing");
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});

describe("schedulesWorkflowRoutes — patch", () => {
  it("PATCH /:sid forwards a sparse patch with expectedKind", async () => {
    const patch = vi.fn(() => okAsync(sampleSchedule));
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { coordinatorAgent: "acme/coord", details: null } }),
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).fireStats).toEqual({ runningCount: 1, awaitingCount: 0 });
    expect(patch).toHaveBeenCalledWith({
      id: "sched-abc",
      expectedKind: "workflow",
      target: { patch: { coordinatorAgent: "acme/coord", details: null } },
    });
  });

  it("PATCH /:sid maps ScheduleKindMismatch to a generic 404", async () => {
    const patch = vi.fn(() =>
      errAsync({
        type: "ScheduleKindMismatch",
        id: "sched-abc",
        expected: "workflow",
        actual: "task",
      }),
    );
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.code).toBe("ScheduleNotFound");
    expect(JSON.stringify(body)).not.toMatch(/task|ScheduleKindMismatch/);
  });
});

describe("schedulesWorkflowRoutes — delete", () => {
  it("DELETE /:sid returns the delete outcome", async () => {
    const del = vi.fn(() => okAsync({ deletedDispatchCount: 2 }));
    const svc = stubModule({ deleteSchedule: { execute: del } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ ok: true, deletedDispatchCount: 2 });
    expect(del).toHaveBeenCalledWith({ id: "sched-abc", expectedKind: "workflow" });
  });

  it.each([
    ["ScheduleNotFound", 404],
    ["ScheduleEnabled", 409],
    ["ScheduleHasInFlight", 409],
  ])("DELETE /:sid maps %s", async (code, status) => {
    const svc = stubModule({
      deleteSchedule: { execute: vi.fn(() => errAsync({ type: code, id: "sched-abc" })) },
    });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc", { method: "DELETE" });
    expect(res.status).toBe(status);
    expect((await jsonBody(res)).code).toBe(code);
  });
});

describe("schedulesWorkflowRoutes — run", () => {
  it("POST /:sid/run returns { dispatchId }", async () => {
    const run = vi.fn(() => okAsync({ dispatchId: "workflow-fresh" }));
    const svc = stubModule({ runSchedule: { execute: run } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc/run", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ dispatchId: "workflow-fresh" });
    expect(run).toHaveBeenCalledWith({ id: "sched-abc", expectedKind: "workflow" });
  });

  it("POST /:sid/run maps ScheduleNotFound to 404", async () => {
    const svc = stubModule({
      runSchedule: { execute: vi.fn(() => errAsync({ type: "ScheduleNotFound", id: "ghost" })) },
    });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/ghost/run", { method: "POST" });
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});

describe("schedulesWorkflowRoutes — preview", () => {
  it("GET /:sid/preview returns describe + nextRuns", async () => {
    const svc = stubModule({});
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/sched-abc/preview");
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).nextRuns).toHaveLength(3);
    expect(svc.previewSchedule.execute).toHaveBeenCalledWith({
      expr: sampleSchedule.trigger.expr,
      tz: sampleSchedule.trigger.tz,
      n: 3,
    });
  });

  it.each(["0", "101"])("GET /:sid/preview?n=%s returns 400", async (n) => {
    const svc = stubModule({});
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request(`/sched-abc/preview?n=${n}`);
    await expectValidation400(res, /n|Number/);
    expect(svc.previewSchedule.execute).not.toHaveBeenCalled();
  });

  it("GET /:sid/preview returns 404 when the schedule is missing", async () => {
    const svc = stubModule({ getSchedule: { execute: vi.fn(() => okAsync(null)) } });
    const res = await schedulesWorkflowRoutes(
      () => svc,
      () => stubWorkflowModule(),
    ).request("/missing/preview");
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});
