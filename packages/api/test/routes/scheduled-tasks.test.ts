/**
 * Route-level tests for `routes/schedules/scheduled-tasks.ts`. Sibling of
 * `tasks.test.ts` — same stub pattern, same vitest layout. The route
 * is read-only (a single `GET /` handler) so the assertion surface is
 * smaller than `/tasks`; we cover origin pinning, the per-query-param
 * passthrough, the validation 400s, and the AND-compose of every
 * filter at once.
 *
 * `?origin=` is intentionally NOT a route param here: origin is
 * hardcoded to `['schedule']` server-side. Each origin's caller
 * surface gets a URL whose path IS the contract.
 */

import type { DispatchTaskResponse as Task, TaskModule } from "@glyphs-ai/task";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { scheduledTasksRoutes } from "../../src/routes/schedules/scheduled-tasks.js";

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

// biome-ignore lint/suspicious/noExplicitAny: transport tests assert on dynamically-shaped JSON bodies
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;
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
    expect(body.error).toMatch(/ISO 8601/);
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
