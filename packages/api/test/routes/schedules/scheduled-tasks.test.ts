/**
 * Route-level tests for `routes/schedules/scheduled-tasks.ts` — both surfaces
 * that module owns: the task-kind schedule CRUD (`schedulesTaskRoutes`) and the
 * list of tasks a schedule has launched (`scheduledTasksRoutes`, origin-pinned
 * to `"schedule"`).
 */

import type {
  CreateScheduleResponse,
  PreviewScheduleResponse,
  ScheduleModule,
} from "@glyphs-ai/schedule";
import type { DispatchTaskResponse as Task, TaskModule } from "@glyphs-ai/task";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import {
  scheduledTasksRoutes,
  schedulesTaskRoutes,
} from "../../../src/routes/schedules/scheduled-tasks.js";

// biome-ignore lint/suspicious/noExplicitAny: route tests assert dynamic JSON envelopes
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

const sampleSchedule: CreateScheduleResponse = {
  id: "sched-abc" as CreateScheduleResponse["id"],
  name: "Weekday morning summary",
  target: {
    kind: "task",
    data: {
      agent: "writer",
      brief: "Summarise yesterday's commits",
      details: "Pull yesterday's commit log and produce a short digest.",
      runtime: "copilot",
    },
  },
  trigger: { kind: "cron", expr: "0 9 * * 1-5", tz: "Asia/Shanghai" },
  enabled: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  nextFireAt: "2026-06-02T01:00:00.000Z",
};

const validTarget = {
  agent: "writer",
  brief: "Summarise yesterday's commits",
  details: "Pull yesterday's commit log and produce a short digest.",
  runtime: "copilot",
};

const wireSample = {
  ...sampleSchedule,
  // Wire target == the stored data verbatim; `kind` is implied by the URL path.
  target: validTarget,
};

function stubUseCase<T>(response: T) {
  return { execute: vi.fn(() => okAsync(response)) };
}

function previewResponse(n: number): PreviewScheduleResponse {
  return {
    describe: "every weekday at 09:00",
    nextRuns: Array.from(
      { length: n },
      (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}T01:00:00.000Z`,
    ),
  };
}

function stubModule(overrides: Partial<Record<keyof ScheduleModule, unknown>>): ScheduleModule {
  return {
    listSchedules: stubUseCase([sampleSchedule]),
    createSchedule: stubUseCase(sampleSchedule),
    getSchedule: stubUseCase(sampleSchedule),
    patchSchedule: stubUseCase(sampleSchedule),
    deleteSchedule: stubUseCase({ deletedDispatchCount: 0 }),
    runSchedule: stubUseCase({ dispatchId: "task-001" }),
    previewSchedule: {
      execute: vi.fn(({ n = 3 }: { expr: string; tz: string; n?: number }) =>
        okAsync(previewResponse(n)),
      ),
    },
    ...overrides,
  } as unknown as ScheduleModule;
}

async function expectValidation400(res: Response, needle?: RegExp) {
  expect(res.status).toBe(400);
  const body = await jsonBody(res);
  expect(body.code).toBeDefined();
  if (needle) expect(JSON.stringify(body)).toMatch(needle);
  return body;
}

describe("schedulesTaskRoutes — list", () => {
  it("GET / returns task schedules with the concrete flat target", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual([wireSample]);
    expect(svc.listSchedules.execute).toHaveBeenCalledWith({ kind: "task" });
  });

  it("GET /?agent=x&enabled=true maps task filters", async () => {
    const list = vi.fn(() => okAsync([]));
    const svc = stubModule({ listSchedules: { execute: list } });
    const res = await schedulesTaskRoutes(() => svc).request("/?agent=writer&enabled=true");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      kind: "task",
      dataEquals: { path: "$.agent", value: "writer" },
      enabled: true,
    });
  });

  it("GET /?enabled=bogus returns 400 with a typed validation code", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/?enabled=bogus");
    await expectValidation400(res, /enabled/);
    expect(svc.listSchedules.execute).not.toHaveBeenCalled();
  });
});

describe("schedulesTaskRoutes — create", () => {
  it("POST / creates and returns 201", async () => {
    const create = vi.fn(() => okAsync(sampleSchedule));
    const svc = stubModule({ createSchedule: { execute: create } });
    const res = await schedulesTaskRoutes(() => svc).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sampleSchedule.name,
        target: validTarget,
        trigger: sampleSchedule.trigger,
      }),
    });
    expect(res.status).toBe(201);
    expect((await jsonBody(res)).target).toEqual(validTarget);
    expect(create).toHaveBeenCalledWith({
      name: sampleSchedule.name,
      target: { kind: "task", data: validTarget },
      trigger: sampleSchedule.trigger,
    });
  });

  it.each([
    ["missing name", { target: validTarget, trigger: sampleSchedule.trigger }, /name/],
    [
      "missing brief",
      { name: "x", target: { agent: "writer" }, trigger: sampleSchedule.trigger },
      /brief/,
    ],
    [
      "empty agent",
      { name: "x", target: { ...validTarget, agent: "" }, trigger: sampleSchedule.trigger },
      /agent/,
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
    const res = await schedulesTaskRoutes(() => svc).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await expectValidation400(res, needle);
    expect(svc.createSchedule.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["InvalidCronExpr", { type: "InvalidCronExpr", expr: "bogus", reason: "not a cron" }],
    ["InvalidTimezone", { type: "InvalidTimezone", tz: "Mars/Olympus" }],
    ["InvalidScheduleName", { type: "InvalidScheduleName", name: "" }],
  ])("POST / maps %s to 400 with a typed code", async (code, error) => {
    const create = vi.fn(() => errAsync(error));
    const svc = stubModule({ createSchedule: { execute: create } });
    const res = await schedulesTaskRoutes(() => svc).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", target: validTarget, trigger: sampleSchedule.trigger }),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe(code);
  });
});

describe("schedulesTaskRoutes — get", () => {
  it("GET /:sid returns the schedule with describe", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toMatchObject(wireSample);
    expect(typeof body.describe).toBe("string");
    expect(body.describe.length).toBeGreaterThan(0);
    expect(svc.getSchedule.execute).toHaveBeenCalledWith({ id: "sched-abc", expectedKind: "task" });
  });

  it("GET /:sid returns 404 when the service returns null", async () => {
    const svc = stubModule({ getSchedule: { execute: vi.fn(() => okAsync(null)) } });
    const res = await schedulesTaskRoutes(() => svc).request("/missing");
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});

describe("schedulesTaskRoutes — patch", () => {
  it("PATCH /:sid forwards a sparse patch with expectedKind", async () => {
    const patch = vi.fn(() => okAsync(sampleSchedule));
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        target: { brief: "New brief", details: null, runtime: null },
      }),
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).target).toEqual(validTarget);
    expect(patch).toHaveBeenCalledWith({
      id: "sched-abc",
      expectedKind: "task",
      enabled: false,
      target: { patch: { brief: "New brief", details: null, runtime: null } },
    });
  });

  it("PATCH /:sid rejects unknown keys", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { kind: "task", agent: "writer" } }),
    });
    await expectValidation400(res, /kind/);
    expect(svc.patchSchedule.execute).not.toHaveBeenCalled();
  });

  it("PATCH /:sid maps ScheduleKindMismatch to a generic 404", async () => {
    const patch = vi.fn(() =>
      errAsync({
        type: "ScheduleKindMismatch",
        id: "sched-abc",
        expected: "task",
        actual: "workflow",
      }),
    );
    const svc = stubModule({ patchSchedule: { execute: patch } });
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.code).toBe("ScheduleNotFound");
    expect(JSON.stringify(body)).not.toMatch(/workflow|ScheduleKindMismatch/);
  });
});

describe("schedulesTaskRoutes — delete", () => {
  it("DELETE /:sid returns the delete outcome", async () => {
    const del = vi.fn(() => okAsync({ deletedDispatchCount: 7 }));
    const svc = stubModule({ deleteSchedule: { execute: del } });
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ ok: true, deletedDispatchCount: 7 });
    expect(del).toHaveBeenCalledWith({ id: "sched-abc", expectedKind: "task" });
  });

  it.each([
    ["ScheduleNotFound", 404],
    ["ScheduleEnabled", 409],
    ["ScheduleHasInFlight", 409],
  ])("DELETE /:sid maps %s", async (code, status) => {
    const del = vi.fn(() => errAsync({ type: code, id: "sched-abc" }));
    const svc = stubModule({ deleteSchedule: { execute: del } });
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc", { method: "DELETE" });
    expect(res.status).toBe(status);
    expect((await jsonBody(res)).code).toBe(code);
  });
});

describe("schedulesTaskRoutes — run", () => {
  it("POST /:sid/run returns { dispatchId }", async () => {
    const run = vi.fn(() => okAsync({ dispatchId: "task-fresh" }));
    const svc = stubModule({ runSchedule: { execute: run } });
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc/run", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ dispatchId: "task-fresh" });
    expect(run).toHaveBeenCalledWith({ id: "sched-abc", expectedKind: "task" });
  });

  it("POST /:sid/run maps ScheduleNotFound to 404", async () => {
    const svc = stubModule({
      runSchedule: { execute: vi.fn(() => errAsync({ type: "ScheduleNotFound", id: "ghost" })) },
    });
    const res = await schedulesTaskRoutes(() => svc).request("/ghost/run", { method: "POST" });
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});

describe("schedulesTaskRoutes — preview", () => {
  it("GET /:sid/preview returns describe + nextRuns with default n=3", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc/preview");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.describe).toBe("every weekday at 09:00");
    expect(body.nextRuns).toHaveLength(3);
    expect(svc.previewSchedule.execute).toHaveBeenCalledWith({
      expr: sampleSchedule.trigger.expr,
      tz: sampleSchedule.trigger.tz,
      n: 3,
    });
  });

  it("GET /:sid/preview?n=10 forwards n", async () => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request("/sched-abc/preview?n=10");
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).nextRuns).toHaveLength(10);
    expect(svc.previewSchedule.execute).toHaveBeenCalledWith({
      expr: sampleSchedule.trigger.expr,
      tz: sampleSchedule.trigger.tz,
      n: 10,
    });
  });

  it.each(["0", "101", "abc"])("GET /:sid/preview?n=%s returns 400", async (n) => {
    const svc = stubModule({});
    const res = await schedulesTaskRoutes(() => svc).request(`/sched-abc/preview?n=${n}`);
    await expectValidation400(res, /n|Number/);
    expect(svc.previewSchedule.execute).not.toHaveBeenCalled();
  });

  it("GET /:sid/preview returns 404 when the schedule is missing", async () => {
    const svc = stubModule({ getSchedule: { execute: vi.fn(() => okAsync(null)) } });
    const res = await schedulesTaskRoutes(() => svc).request("/missing/preview");
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("ScheduleNotFound");
  });
});

const sampleScheduledTask: Task = {
  id: "20260601-sched0001",
  agent: "writer",
  brief: "Scheduled draft",
  status: "running",
  origin: "schedule",
  metadata: {
    workdir: "/tmp/wd",
    runtime: "copilot",
    runtimeSessionId: "11111111-2222-3333-4444-555555555555",
    pid: 4242,
    scheduleId: "sched-abc",
  },
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
} as unknown as Task;

function stubManager(overrides: {
  list?: ReturnType<typeof vi.fn>;
}): TaskModule & { list: ReturnType<typeof vi.fn> } {
  const list = overrides.list ?? vi.fn(() => okAsync([sampleScheduledTask]));
  return {
    list,
    listTasks: { execute: list },
  } as unknown as TaskModule & { list: ReturnType<typeof vi.fn> };
}

describe("scheduledTasksRoutes", () => {
  it("GET / lists schedule-origin tasks (hardcodes origin=['schedule'])", async () => {
    const m = stubManager({});
    const res = await scheduledTasksRoutes(() => m).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe(sampleScheduledTask.id);
    expect(m.list).toHaveBeenCalledTimes(1);
    expect(m.list).toHaveBeenCalledWith({ origin: "schedule" });
  });

  it("GET /?scheduleId=<id> ANDs the scheduleId filter onto origin=['schedule']", async () => {
    const list = vi.fn(() => okAsync([sampleScheduledTask]));
    const m = stubManager({ list });
    const res = await scheduledTasksRoutes(() => m).request("/?scheduleId=sched-abc");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "sched-abc",
    });
  });

  it("GET /?status=running forwards the single status filter", async () => {
    const list = vi.fn(() => okAsync([sampleScheduledTask]));
    const m = stubManager({ list });
    const res = await scheduledTasksRoutes(() => m).request("/?status=running");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "schedule",
      status: "running",
    });
  });

  it("GET /?status=bogus returns 400 with the shared ValidationError envelope", async () => {
    const m = stubManager({});
    const res = await scheduledTasksRoutes(() => m).request("/?status=bogus");
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(m.list).not.toHaveBeenCalled();
  });

  it("GET /?createdSince=not-a-date returns 400", async () => {
    const m = stubManager({});
    const res = await scheduledTasksRoutes(() => m).request("/?createdSince=not-a-date");
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.detail).toMatch(/ISO 8601/);
    expect(m.list).not.toHaveBeenCalled();
  });

  it("GET / AND-composes every filter (scheduleId, agent, runtime, createdSince, status)", async () => {
    const list = vi.fn(() => okAsync([sampleScheduledTask]));
    const m = stubManager({ list });
    const res = await scheduledTasksRoutes(() => m).request(
      "/?createdSince=2026-05-27T00%3A00%3A00.000Z&agent=writer&runtime=copilot&scheduleId=sched-x&status=running",
    );
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "schedule",
      agent: "writer",
      runtime: "copilot",
      createdSince: "2026-05-27T00:00:00.000Z",
      status: "running",
      originId: "sched-x",
    });
  });

  it("GET / keeps schedule origin pinned when unrelated query params are present", async () => {
    // Hono passes unknown query params through; this route only reads
    // its manifest-declared filters and keeps origin pinned.
    const list = vi.fn(() => okAsync([sampleScheduledTask]));
    const m = stubManager({ list });
    const res = await scheduledTasksRoutes(() => m).request("/?origin=standalone");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ origin: "schedule" });
  });
});
