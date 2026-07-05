/**
 * Route-level tests for `routes/schedules/scheduled-workflows.ts` — both
 * surfaces that module owns: the workflow-kind schedule CRUD (with `fireStats`
 * enrichment, `schedulesWorkflowRoutes`) and the list of workflows a schedule
 * has launched (`scheduledWorkflowsRoutes`, origin-pinned to `"schedule"`).
 */

import type {
  CreateScheduleResponse,
  PreviewScheduleResponse,
  ScheduleModule,
} from "@glyphs-ai/schedule";
import type { GetWorkflowResponse, WorkflowModule } from "@glyphs-ai/workflow";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import {
  scheduledWorkflowsRoutes,
  schedulesWorkflowRoutes,
} from "../../../src/routes/schedules/scheduled-workflows.js";

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

// Stub the use-cases the route consumes. Each is a `{ execute }`
// container returning a `ResultAsync`; `listWorkflows` yields views.
function stubWorkflowRunsModule(
  overrides: { listWorkflows?: { execute: ReturnType<typeof vi.fn> } } = {},
): WorkflowModule {
  const stub = {
    listWorkflows: overrides.listWorkflows ?? { execute: vi.fn(() => okAsync([])) },
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
    const svc = stubWorkflowRunsModule({ listWorkflows });
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
    const svc = stubWorkflowRunsModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/?scheduleId=sched-abc");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_A]);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "sched-abc",
    });
  });

  it("returns workflow read models without api enrichment", async () => {
    const listWorkflows = {
      execute: vi.fn(() =>
        okAsync([
          makeWf(WF_A, { scheduleId: "sched-abc" }),
          makeWf(WF_B, { scheduleId: "sched-abc" }),
        ]),
      ),
    };
    const svc = stubWorkflowRunsModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    for (const row of body) {
      expect(Object.hasOwn(row, "awaitingHumanCount")).toBe(false);
      expect(Object.hasOwn(row, "iterationCount")).toBe(false);
    }
  });

  it("returns the workflow header fields from the read model", async () => {
    const listWorkflows = {
      execute: vi.fn(() => okAsync([makeWf(WF_A, { scheduleId: "sched-abc" })])),
    };
    const svc = stubWorkflowRunsModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await jsonBody(res);
    // Enrichment is intentionally deferred to callers.
    expect(Object.hasOwn(body[0], "iterationCount")).toBe(false);
    expect(Object.hasOwn(body[0], "awaitingHumanCount")).toBe(false);
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
    const svc = stubWorkflowRunsModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    const body = await jsonBody(res);
    expect(body.map((w: { id: string }) => w.id)).toEqual([WF_NEWEST, WF_MID, WF_OLDEST]);
  });

  it("returns [] when no workflows were launched by a schedule", async () => {
    const listWorkflows = { execute: vi.fn(() => okAsync([])) };
    const svc = stubWorkflowRunsModule({ listWorkflows });
    const res = await scheduledWorkflowsRoutes(() => svc).request("/");
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual([]);
  });
});
