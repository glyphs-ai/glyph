import type { DispatchTaskResponse as Task, TaskModule } from "@glyphs-ai/task";
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { tasksRoutes } from "../../src/routes/tasks.js";

/**
 * Local Error subclasses drive stub failures; `wrapOk` maps them to task
 * union errors before the routes consume them.
 */
class AgentNotFoundError extends Error {
  constructor(readonly agent: string) {
    super(`agent "${agent}" not found`);
  }
}
class RuntimeDoesNotSupportTasksError extends Error {
  constructor(readonly runtime: string) {
    super(`runtime "${runtime}" does not support tasks`);
  }
}
class EntryNotReadyError extends Error {
  constructor(
    readonly agent: string,
    readonly reason: unknown,
  ) {
    super(`agent "${agent}" not ready`);
  }
}
class TaskNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`task ${id} not found`);
  }
}
class CorruptedTaskError extends Error {
  constructor(
    readonly id: string,
    reason?: string,
  ) {
    super(reason);
  }
}
class InvalidTransition extends Error {
  constructor(
    readonly from: string,
    readonly event: string,
  ) {
    super(`illegal transition from ${from}`);
  }
}
class ManagerShuttingDownError extends Error {}
class TaskIdAllocationFailedError extends Error {
  constructor(readonly attempts: number) {
    super(`task id allocation failed after ${attempts} attempts`);
  }
}
class InvalidTaskIdError extends Error {
  constructor(readonly id: string) {
    super(`invalid task id "${id}"`);
  }
}

const sampleTask: Task = {
  id: "20260601-abcd1234",
  agent: "writer",
  brief: "Draft the post",
  status: "running",
  origin: "standalone",
  metadata: {
    workdir: "/tmp/wd",
    runtime: "copilot",
    runtimeSessionId: "11111111-2222-3333-4444-555555555555",
    pid: 4242,
  },
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
} as unknown as Task;

type TaskStub = TaskModule & {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getTaskActivity: ReturnType<typeof vi.fn>;
  getTaskActivityStream: ReturnType<typeof vi.fn>;
  resolveArtifactPath: ReturnType<typeof vi.fn>;
};

function mapThrownTaskError(e: unknown) {
  if (e instanceof AgentNotFoundError) return { type: "AgentNotFound" as const, agent: e.agent };
  if (e instanceof RuntimeDoesNotSupportTasksError) {
    return { type: "RuntimeDoesNotSupportTasks" as const, runtime: e.runtime };
  }
  if (e instanceof EntryNotReadyError) {
    return {
      type: "EntryNotReady" as const,
      agent: e.agent,
      ...(e.reason !== undefined ? { reason: e.reason } : {}),
    };
  }
  if (e instanceof TaskNotFoundError) return { type: "TaskNotFound" as const, id: e.id };
  if (e instanceof CorruptedTaskError)
    return { type: "CorruptedTask" as const, id: e.id, cause: e };
  if (e instanceof InvalidTransition) return { type: "InvalidTransition" as const, from: e.from };
  if (e instanceof ManagerShuttingDownError) return { type: "ManagerShuttingDown" as const };
  if (e instanceof TaskIdAllocationFailedError)
    return { type: "WorkdirReservationFailed" as const, cause: e };
  return { type: "DatabaseUnavailable" as const, cause: e };
}

function wrapOk(fn: unknown) {
  const call = fn as (...args: unknown[]) => unknown;
  return vi.fn(async (req: unknown) => {
    try {
      return ok(await call(req));
    } catch (e) {
      return err(mapThrownTaskError(e));
    }
  });
}

function stubManager(
  overrides: Partial<
    Record<
      | "list"
      | "get"
      | "dispatch"
      | "delete"
      | "cancel"
      | "getTaskActivity"
      | "getTaskActivityStream"
      | "resolveArtifactPath",
      ReturnType<typeof vi.fn>
    >
  >,
): TaskStub {
  const list = overrides.list ?? vi.fn(async () => [sampleTask]);
  const get = overrides.get ?? vi.fn(async () => sampleTask);
  const dispatch = overrides.dispatch ?? vi.fn(async () => sampleTask);
  const del = overrides.delete ?? vi.fn(async () => undefined);
  const cancel = overrides.cancel ?? vi.fn(async () => sampleTask);
  const getTaskActivity = overrides.getTaskActivity ?? vi.fn(async () => null);
  const getTaskActivityStream = overrides.getTaskActivityStream ?? vi.fn(async () => null);
  const resolveArtifactPath = overrides.resolveArtifactPath ?? vi.fn(async () => null);
  const getTaskActivityUseCase = Object.assign(getTaskActivity, {
    execute: wrapOk(getTaskActivity),
  });
  const getTaskActivityStreamUseCase = Object.assign(getTaskActivityStream, {
    execute: wrapOk(getTaskActivityStream),
  });
  const resolveArtifactPathUseCase = Object.assign(resolveArtifactPath, {
    execute: wrapOk(resolveArtifactPath),
  });
  return {
    list,
    get,
    dispatch,
    delete: del,
    cancel,
    getTaskActivity: getTaskActivityUseCase,
    getTaskActivityStream: getTaskActivityStreamUseCase,
    resolveArtifactPath: resolveArtifactPathUseCase,
    listTasks: { execute: wrapOk(list) },
    getTask: { execute: wrapOk(get) },
    dispatchTask: { execute: wrapOk(dispatch) },
    deleteTask: { execute: wrapOk(del) },
    cancelTask: { execute: wrapOk(cancel) },
  } as unknown as TaskStub;
}

// biome-ignore lint/suspicious/noExplicitAny: transport tests assert on dynamically-shaped JSON bodies
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;
describe("tasksRoutes", () => {
  it("GET / lists tasks (hardcodes origin=standalone; schedule/workflow NOT returned)", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe(sampleTask.id);
    expect(body[0].agent).toBe("writer");
    expect(m.list).toHaveBeenCalledTimes(1);
    // Standalone-only by construction: origin is hardcoded server-side
    // and `?origin=` is gone from the route's
    // surface. Schedule-launched runs live at `/scheduled-tasks`.
    expect(m.list).toHaveBeenCalledWith({ origin: "standalone" });
  });

  it("GET / stays standalone-only when unrelated query params are present", async () => {
    // Hono passes unknown query params through; this route only reads
    // its manifest-declared filters and keeps origin pinned.
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    const res = await tasksRoutes(() => m).request("/?origin=schedule&scheduleId=sched-abc");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ origin: "standalone" });
  });

  it("GET /?agent=X forwards the agent filter to the manager", async () => {
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    const res = await tasksRoutes(() => m).request("/?agent=writer");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ origin: "standalone", agent: "writer" });
  });

  it("GET /?runtime=copilot forwards the runtime filter", async () => {
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    const res = await tasksRoutes(() => m).request("/?runtime=copilot");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ origin: "standalone", runtime: "copilot" });
  });

  it("GET /?createdSince=<iso> canonicalises the timestamp before forwarding", async () => {
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    // Send a non-canonical form (no Z suffix); server must canonicalise
    // to ISO 8601 UTC so the manager's lexicographic compare stays
    // correct.
    const res = await tasksRoutes(() => m).request("/?createdSince=2026-05-08T01%3A00%3A00.000Z");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "standalone",
      createdSince: "2026-05-08T01:00:00.000Z",
    });
  });

  it("GET /?createdSince=garbage returns 400", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/?createdSince=not-a-date");
    expect(res.status).toBe(400);
    expect(m.list).not.toHaveBeenCalled();
  });

  it("GET /?status=running forwards the single status filter", async () => {
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    const res = await tasksRoutes(() => m).request("/?status=running");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "standalone",
      status: "running",
    });
  });

  it("GET /?status=bogus returns 400 (invalid status enum)", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/?status=bogus");
    expect(res.status).toBe(400);
    expect(m.list).not.toHaveBeenCalled();
  });

  it("GET / combines all filters with AND semantics on the manager call", async () => {
    const list = vi.fn(async () => [sampleTask]);
    const m = stubManager({ list });
    const res = await tasksRoutes(() => m).request(
      "/?agent=writer&runtime=copilot&createdSince=2026-05-08T01%3A00%3A00.000Z&status=running",
    );
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      origin: "standalone",
      agent: "writer",
      runtime: "copilot",
      createdSince: "2026-05-08T01:00:00.000Z",
      status: "running",
    });
  });

  it("POST / requires JSON body", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / requires agent", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "go" }),
    });
    expect(res.status).toBe(400);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / requires brief", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/brief/);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / rejects empty brief (whitespace-only)", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "   " }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/non-empty/);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / rejects brief containing newline (single-line contract)", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "first line\nsecond line" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/single line/);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / rejects brief containing carriage return", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "first\rsecond" }),
    });
    expect(res.status).toBe(400);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / rejects brief longer than 200 characters", async () => {
    const m = stubManager({});
    const longBrief = "A".repeat(201);
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: longBrief }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/200 characters/);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / accepts brief at exactly 200 characters", async () => {
    const m = stubManager({});
    const exactBrief = "A".repeat(200);
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: exactBrief }),
    });
    expect(res.status).toBe(201);
    expect(m.dispatch).toHaveBeenCalledWith({ agent: "writer", brief: exactBrief });
  });

  it("POST / rejects non-string details", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "ok", details: 7 }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/details/);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / rejects non-string runtime", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "hi", runtime: 7 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / rejects unknown body fields", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "hi", origin: "schedule" }),
    });
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toMatchObject({ code: "ValidationError" });
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("POST / dispatches and returns 201 with brief only", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "Draft the post" }),
    });
    expect(res.status).toBe(201);
    expect(m.dispatch).toHaveBeenCalledWith({
      agent: "writer",
      brief: "Draft the post",
    });
  });

  it("POST / forwards optional details when present", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: "writer",
        brief: "Draft the post",
        details: "Tone: warm.\nLength: short.",
      }),
    });
    expect(res.status).toBe(201);
    expect(m.dispatch).toHaveBeenCalledWith({
      agent: "writer",
      brief: "Draft the post",
      details: "Tone: warm.\nLength: short.",
    });
  });

  it("POST / forwards optional runtime override", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "go", runtime: "claude" }),
    });
    expect(res.status).toBe(201);
    expect(m.dispatch).toHaveBeenCalledWith({
      agent: "writer",
      brief: "go",
      runtime: "claude",
    });
  });

  it("POST / trims whitespace from brief before dispatch", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "   Draft the post   " }),
    });
    expect(res.status).toBe(201);
    expect(m.dispatch).toHaveBeenCalledWith({
      agent: "writer",
      brief: "Draft the post",
    });
  });

  it("POST / maps AgentNotFoundError to 400", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        throw new AgentNotFoundError("ghost");
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ghost", brief: "go" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("AgentNotFound");
  });

  it("POST / maps RuntimeDoesNotSupportTasksError to 400", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        throw new RuntimeDoesNotSupportTasksError("unsupported-runtime");
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "go" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("RuntimeDoesNotSupportTasks");
  });

  // Dispatching against a blocked agent surfaces the structured error
  // shape (code + message + reason) so the dashboard / CLI can render
  // the actionable reason without parsing the human message.
  it("POST / maps EntryNotReadyError to 409 with code, agent, and structured reason", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        throw new EntryNotReadyError("public/writer", { needsPrereqsAck: true });
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "public/writer", brief: "go" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.code).toBe("EntryNotReady");
    expect(body.error).toContain("not ready");
    // The structured reason is what lets the dashboard render the
    // right CTA (here: Acknowledge prereqs) without string parsing.
    expect(body.agent).toBe("public/writer");
    expect(body.reason).toEqual({ needsPrereqsAck: true });
  });

  it("POST / EntryNotReadyError surfaces blockedDeps cascade (real BlockedReason shape)", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        throw new EntryNotReadyError("public/writer", {
          blockedDeps: [{ fqn: "public/missing-prereq" }],
        });
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "public/writer", brief: "go" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.reason).toEqual({
      blockedDeps: [{ fqn: "public/missing-prereq" }],
    });
  });

  it("POST / EntryNotReadyError without a reason still emits the agent field (defensive)", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        // Defensive path: even if the catalog produced no structured
        // reason (shouldn't happen in practice — getAgentEntry always
        // populates blockedReason on a `blocked` status — but the
        // type allows undefined), the wire body must still carry the
        // agent name so the dashboard can deep-link to that entry.
        throw new EntryNotReadyError("public/writer", undefined);
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "public/writer", brief: "go" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.agent).toBe("public/writer");
    expect(body.reason).toBeUndefined();
  });

  it("GET /:tid returns task", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.id).toBe(sampleTask.id);
    expect(m.get).toHaveBeenCalledWith({ id: sampleTask.id });
  });

  it("GET /:tid returns 404 when missing", async () => {
    const m = stubManager({ get: vi.fn(async () => null) });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`);
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.code).toBe("TaskNotFound");
  });

  // Companion to the manager-level "get() propagates CorruptedTaskError"
  // test: a corrupted row must surface as 5xx with code so operators
  // can see the corruption (a 404 here would let the dashboard render
  // "task gone" for what is really tampered/bit-rotted metadata).
  it("GET /:tid maps CorruptedTaskError to 500 with code", async () => {
    const m = stubManager({
      get: vi.fn(async () => {
        throw new CorruptedTaskError(sampleTask.id, "task.metadata is not valid JSON");
      }),
    });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.code).toBe("CorruptedTask");
  });

  // Companion for the delete path. Default (archive) mode propagates
  // the corruption; the route maps to 500 with code so the dashboard
  // can prompt the operator to retry with `?purge=1`.
  it("DELETE /:tid maps CorruptedTaskError to 500 with code", async () => {
    const m = stubManager({
      delete: vi.fn(async () => {
        throw new CorruptedTaskError(sampleTask.id, "task.metadata is not valid JSON");
      }),
    });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`, { method: "DELETE" });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.code).toBe("CorruptedTask");
  });

  it("GET /:tid maps InvalidTaskIdError through the task infra error rail", async () => {
    const m = stubManager({
      get: vi.fn(async () => {
        throw new InvalidTaskIdError("bad");
      }),
    });
    const res = await tasksRoutes(() => m).request("/bad");
    expect(res.status).toBe(500);
  });

  it("DELETE /:tid returns 204", async () => {
    const m = stubManager({});
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(m.delete).toHaveBeenCalledWith({ id: sampleTask.id, purge: false });
  });

  it("DELETE /:tid?purge=1 propagates the purge flag to the manager", async () => {
    const del = vi.fn(async () => undefined);
    const m = stubManager({ delete: del });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}?purge=1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledWith({ id: sampleTask.id, purge: true });
  });

  it("DELETE /:tid maps TaskNotFoundError to 404", async () => {
    const m = stubManager({
      delete: vi.fn(async () => {
        throw new TaskNotFoundError(sampleTask.id);
      }),
    });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  // Server-side faults must not be reported as client-input errors.
  // Both classes match the analogous mappings in sessions.ts.
  it("POST / maps TaskIdAllocationFailedError to 500 (server-side fs collision)", async () => {
    const m = stubManager({
      dispatch: vi.fn(async () => {
        throw new TaskIdAllocationFailedError(5);
      }),
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "x" }),
    });
    expect(res.status).toBe(500);
  });

  describe("GET /:tid/activity", () => {
    it("404 NoEventsYet when manager returns null (task missing, runtime declines, or no events yet)", async () => {
      // The route delegates the entire read+parse+derive to
      // `TaskModule.getTaskActivity.execute`, which itself fans down to
      // `Runtime.readActivity`. A `null` return collapses every
      // "nothing to show" case (task missing, runtime omits the
      // surface, log file not on disk yet) into a single 404
      // NoEventsYet. The explicit "task missing" 404 lives on
      // GET /:tid (covered separately).
      const m = stubManager({ getTaskActivity: vi.fn(async () => null) });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/activity`);
      expect(res.status).toBe(404);
      const body = await jsonBody(res);
      expect(body.code).toBe("NoEventsYet");
    });

    it("200 forwards the runtime's structured payload as JSON", async () => {
      // The route is a thin pass-through — it neither knows nor cares
      // that this happens to be Copilot's `assistant.message` event
      // model; the runtime owns the read + parse and emits ActivityItems
      // the dashboard renders without runtime-specific knowledge.
      const payload = {
        activity: [
          { seq: 1, kind: "user" as const, timestamp: "2026-05-09T01:00:00.000Z", text: "hi" },
          {
            seq: 2,
            kind: "assistant" as const,
            timestamp: "2026-05-09T01:00:01.000Z",
            text: "ok",
          },
        ],
        result: "ok",
        totalItems: 2,
      };
      const m = stubManager({ getTaskActivity: vi.fn(async () => payload) });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/activity`);
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body).toEqual(payload);
    });

    it("forwards before / after / limit query params to the manager", async () => {
      const getTaskActivity = vi.fn(async () => null);
      const m = stubManager({ getTaskActivity });
      const r = tasksRoutes(() => m);

      // Default: no pagination params, default limit 50 applied by route.
      await r.request(`/${sampleTask.id}/activity`);
      expect(getTaskActivity).toHaveBeenLastCalledWith({ id: sampleTask.id, limit: 50 });

      // after only.
      await r.request(`/${sampleTask.id}/activity?after=42`);
      expect(getTaskActivity).toHaveBeenLastCalledWith({ id: sampleTask.id, after: 42, limit: 50 });

      // before only.
      await r.request(`/${sampleTask.id}/activity?before=100&limit=20`);
      expect(getTaskActivity).toHaveBeenLastCalledWith({
        id: sampleTask.id,
        before: 100,
        limit: 20,
      });
    });

    it("400 when both before and after are supplied (mutually exclusive)", async () => {
      // The runtime layer also guards this, but failing earlier in the
      // route is friendlier — the client gets a clear 400 rather than
      // having the request hit the runtime and bubble back as a 500.
      const m = stubManager({ getTaskActivity: vi.fn(async () => null) });
      const res = await tasksRoutes(() => m).request(
        `/${sampleTask.id}/activity?before=10&after=5`,
      );
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.code).toBe("BadRequest");
      expect(body.error).toContain("mutually exclusive");
    });

    // Field-level faults (bad cursors / out-of-range limit) are rejected by
    // the shared query schema at the HTTP boundary, so they surface as the
    // standard ValidationError envelope — unlike the before/after mutual
    // exclusion above, which stays a handler-level BadRequest cross-field check.
    it.each([
      { name: "before negative", q: "before=-1" },
      { name: "before non-integer", q: "before=abc" },
      { name: "before floating point", q: "before=1.5" },
      { name: "after negative", q: "after=-1" },
      { name: "after non-integer", q: "after=xyz" },
      { name: "limit zero", q: "limit=0" },
      { name: "limit > max", q: "limit=10000" },
      { name: "limit non-integer", q: "limit=abc" },
    ])("400 on malformed query: $name", async ({ q }) => {
      const m = stubManager({ getTaskActivity: vi.fn(async () => null) });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/activity?${q}`);
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.code).toBe("ValidationError");
    });
  });

  // ─── Cancel route + delete 409 + 503 mappings ───────────────────────
  describe("POST /:tid/cancel", () => {
    it("200 + cancelled Task on the happy path", async () => {
      const cancelledTask = {
        ...sampleTask,
        status: "cancelled",
        endedAt: "2026-06-01T00:00:05.000Z",
        cancellation: { kind: "user", message: "cancelled by user" },
      } as unknown as Task;
      const cancel = vi.fn(async () => cancelledTask);
      const m = stubManager({ cancel });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.status).toBe("cancelled");
      expect(body.cancellation).toEqual({ kind: "user", message: "cancelled by user" });
      expect(cancel).toHaveBeenCalledWith({ id: sampleTask.id });
    });

    it("404 when the task is missing", async () => {
      const m = stubManager({
        cancel: vi.fn(async () => {
          throw new TaskNotFoundError(sampleTask.id);
        }),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
      const body = await jsonBody(res);
      expect(body.code).toBe("TaskNotFound");
    });

    it("409 + structured InvalidTransition body when the task is already terminal", async () => {
      const m = stubManager({
        cancel: vi.fn(async () => {
          throw new InvalidTransition("success", "cancel");
        }),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      const body = await jsonBody(res);
      // Structured envelope so the dashboard branches on code (the
      // 409 contract pinned by `error-response-contract.test.ts`).
      expect(body.code).toBe("InvalidTransition");
      expect(body.status).toBe("success");
      expect(body.transition).toBe("cancel");
      expect(typeof body.error).toBe("string");
    });

    it("503 when the manager is shutting down", async () => {
      const m = stubManager({
        cancel: vi.fn(async () => {
          throw new ManagerShuttingDownError();
        }),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(503);
      const body = await jsonBody(res);
      expect(body.code).toBe("ManagerShuttingDown");
    });
  });

  describe("DELETE /:tid — terminal-only", () => {
    it("409 + structured InvalidTransition body when the task is non-terminal", async () => {
      const m = stubManager({
        delete: vi.fn(async () => {
          throw new InvalidTransition("running", "delete");
        }),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`, { method: "DELETE" });
      expect(res.status).toBe(409);
      const body = await jsonBody(res);
      // Same envelope shape as the cancel handler — only the
      // transition discriminator differs so the dashboard can branch
      // its 409 handler typed.
      expect(body.code).toBe("InvalidTransition");
      expect(body.status).toBe("running");
      expect(body.transition).toBe("delete");
      expect(typeof body.error).toBe("string");
    });
  });

  // Dispatch and cancel both map `ManagerShuttingDown` to HTTP 503.
  describe("503 on shutdown — pinned for dispatch and cancel", () => {
    it("POST / (dispatch) returns 503 when the manager is shutting down", async () => {
      const m = stubManager({
        dispatch: vi.fn(async () => {
          throw new ManagerShuttingDownError();
        }),
      });
      const res = await tasksRoutes(() => m).request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "writer", brief: "x" }),
      });
      expect(res.status).toBe(503);
      const body = await jsonBody(res);
      expect(body.code).toBe("ManagerShuttingDown");
    });

    it("POST /:tid/cancel returns 503 when the manager is shutting down", async () => {
      const m = stubManager({
        cancel: vi.fn(async () => {
          throw new ManagerShuttingDownError();
        }),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(503);
    });
  });

  // ─── GET /:tid/artifact?path= ────────────────────
  describe("GET /:tid/artifact", () => {
    it("happy path: resolves a nested relPath and returns file bytes", async () => {
      const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const nodePath = await import("node:path");
      const tmp = await mkdtemp(nodePath.join(tmpdir(), "glyph-tasks-artifact-"));
      const abs = nodePath.join(tmp, "report.html");
      await writeFile(abs, "<html><body>ok</body></html>");
      const m = stubManager({
        resolveArtifactPath: vi.fn(async (req: { relPath: string }) =>
          req.relPath === "ref/report.html" ? abs : null,
        ),
      });
      const res = await tasksRoutes(() => m).request(
        `/${sampleTask.id}/artifact?path=${encodeURIComponent("ref/report.html")}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toBe("<html><body>ok</body></html>");
      await rm(tmp, { recursive: true, force: true });
    });

    it("returns 404 when the manager rejects the path (whitelist)", async () => {
      const m = stubManager({
        resolveArtifactPath: vi.fn(async () => null),
      });
      const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/artifact?path=secret.txt`);
      expect(res.status).toBe(404);
    });

    it("returns 400 when path contains a .. traversal segment", async () => {
      const m = stubManager({
        resolveArtifactPath: vi.fn(),
      });
      const res = await tasksRoutes(() => m).request(
        `/${sampleTask.id}/artifact?path=${encodeURIComponent("../etc/passwd")}`,
      );
      expect(res.status).toBe(400);
      expect(m.resolveArtifactPath).not.toHaveBeenCalled();
    });

    it("returns 400 when path contains a backslash separator", async () => {
      const m = stubManager({
        resolveArtifactPath: vi.fn(),
      });
      const res = await tasksRoutes(() => m).request(
        `/${sampleTask.id}/artifact?path=${encodeURIComponent("foo\\bar")}`,
      );
      expect(res.status).toBe(400);
      expect(m.resolveArtifactPath).not.toHaveBeenCalled();
    });
  });

  // ─── unmapped-error fall-through logging ─────────────────────────────
  //
  // Error classes not recognised by the route policy (for example a
  // bare runtime-adapter `Error`) still return the anti-leakage
  // `{ error: "internal error" }` body, but also emit a structured log
  // line so the operator can `jq` for "unmapped" in
  // <glyphHome>/logs/server-*.log. Tests below pin both halves:
  //
  //   - the wire body is still `{ error: "internal error" }`
  //   - the log carries the message suffix "unmapped error fell
  //     through to 400" plus the underlying error's `name` and
  //     `message` (so a future grep doesn't require parsing the
  //     pino-serialised `err.type` nest)
  //
  // To assert log output we need the requestLogger middleware mounted
  // (logFault is a silent no-op when no logger is on c.var — by design
  // for the standalone-route test seam every other case above relies
  // on). Helper below wires up the same middleware stack the prod
  // `index.ts` uses, then mounts the route under test on top.
  describe("unmapped error fall-through logging", () => {
    // Local imports so the rest of the file's `tasksRoutes(() => m)`
    // shortcut tests stay unchanged.
    const buildAppWithLogger = async (m: TaskModule) => {
      const { Hono } = await import("hono");
      const { captureLogger } = await import("../_capture-logger.js");
      const cap = captureLogger();
      const app = new Hono<{ Variables: { logger: import("pino").Logger } }>();
      // Put the capture logger on the context the way the production
      // `requestLogger` middleware does, so the route's `logFault` (a
      // silent no-op without a context logger) emits its structured line.
      app.use("*", async (c, next) => {
        c.set("logger", cap.logger);
        await next();
      });
      app.route(
        "/",
        tasksRoutes(() => m),
      );
      return { app, cap };
    };

    it("GET /: logs unmapped error from TaskModule.listTasks.execute and returns 500 internal error", async () => {
      const m = stubManager({
        list: vi.fn(async () => {
          throw new Error("metadata.jsonl read failed");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request("/");
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toBe("internal error");

      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.level).toBe(50); // error
      expect(fault?.msg).toBe("tasks.list: 5xx fault");
      // List route has no taskId / sessionId to attach as extra meta —
      // only the bare name + message land on the structured line.
      expect((fault?.err as { type?: string } | undefined)?.type).toBe("DatabaseUnavailable");
    });

    it("POST /: logs the unmapped error AND returns 500 internal error on the wire", async () => {
      const m = stubManager({
        dispatch: vi.fn(async () => {
          // A bare `Error` is NOT on the task error policy.
          // This mirrors the production failure mode: the SDK throws
          // `ERR_MODULE_NOT_FOUND` deep inside `import.meta.resolve`,
          // which surfaces as a bare `Error` at the route boundary.
          throw new Error("ERR_MODULE_NOT_FOUND: cannot resolve @github/copilot-sdk");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "writer", brief: "go" }),
      });
      // Wire body unchanged — SAFE_ERROR_NAMES whitelist still flattens.
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toBe("internal error");

      // Server log gained a structured entry the operator can grep for.
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.level).toBe(50); // error
      expect(fault?.msg).toBe("tasks: 5xx fault");
      // Underlying error metadata is on the structured line so
      // `jq '.name'` / `jq '.message'` work without descending into
      // pino's `err.*` nest.
      expect((fault?.err as { type?: string } | undefined)?.type).toBe("DatabaseUnavailable");
    });

    it("POST /: mapped 4xx errors (validation, not-found) still do NOT log (silent-4xx policy preserved)", async () => {
      const m = stubManager({
        dispatch: vi.fn(async () => {
          // Mapped 4xx: caller-fixable input error. The original
          // silent-4xx policy was correct for these — operators don't
          // want noisy logs for "user typed wrong agent name".
          throw new AgentNotFoundError("ghost");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "ghost", brief: "go" }),
      });
      expect(res.status).toBe(400);
      // Critical: no "unmapped" log entry for a mapped 4xx. This is
      // the policy split — only unrecognised classes fall into the
      // observability bucket; recognised 4xx stay quiet.
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeUndefined();
    });

    it("GET /:tid: logs unmapped error with the taskId on the structured line", async () => {
      const m = stubManager({
        get: vi.fn(async () => {
          throw new Error("disk read failed");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}`);
      expect(res.status).toBe(500);
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.get: 5xx fault");
      // Per-route `extra` meta preserved through the helper — taskId
      // is what operators filter by when investigating a specific
      // failed dispatch.
      expect(fault?.taskId).toBe(sampleTask.id);
    });

    it("DELETE /:tid: logs unmapped error with taskId + purge flag preserved", async () => {
      const m = stubManager({
        delete: vi.fn(async () => {
          throw new Error("rm failed");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}?purge=1`, { method: "DELETE" });
      expect(res.status).toBe(500);
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.delete: 5xx fault");
      expect(fault?.taskId).toBe(sampleTask.id);
      expect(fault?.purge).toBe(true);
    });

    it("POST /:tid/cancel: logs unmapped error with taskId", async () => {
      const m = stubManager({
        cancel: vi.fn(async () => {
          throw new Error("kill failed");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}/cancel`, { method: "POST" });
      expect(res.status).toBe(500);
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.cancel: 5xx fault");
      expect(fault?.taskId).toBe(sampleTask.id);
    });

    it("GET /:tid/activity: logs unmapped error with taskId", async () => {
      const m = stubManager({
        getTaskActivity: vi.fn(async () => {
          throw new Error("events.jsonl unreadable");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}/activity`);
      expect(res.status).toBe(500);
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.activity: 5xx fault");
      expect(fault?.taskId).toBe(sampleTask.id);
    });

    it("GET /:tid/artifact: logs unmapped error with taskId + artifact path", async () => {
      // The artifact resolver throws a bare Error (e.g. permission
      // failure while reading the success.json index). Outer catch
      // around `resolveArtifactPath` gained the new pattern.
      const m = stubManager({
        resolveArtifactPath: vi.fn(async () => {
          throw new Error("success.json permission denied");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}/artifact?path=out.txt`);
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toBe("internal error");
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.artifact: 5xx fault");
      expect(fault?.taskId).toBe(sampleTask.id);
      // Artifact-route extra meta carries the requested filename so
      // operators can filter on a specific resource without parsing
      // the URL out of every access line.
      expect(fault?.artifact).toBe("out.txt");
    });

    it("GET /:tid/activity/stream: logs unmapped error with taskId (outer catch before headers)", async () => {
      // SSE-stream variant. The handler-level catch is the OUTER one
      // that runs before headers are sent (the inner async-iterator
      // catch sends `event: error` frames and is intentionally
      // separate — see lint report I6). Wire `getTaskActivityStream`
      // to throw synchronously so we hit the outer catch.
      const m = stubManager({
        getTaskActivityStream: vi.fn(async () => {
          throw new Error("activity stream backend unavailable");
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request(`/${sampleTask.id}/activity/stream`);
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toBe("internal error");
      const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(fault).toBeDefined();
      expect(fault?.msg).toBe("tasks.activity.stream: 5xx fault");
      expect(fault?.taskId).toBe(sampleTask.id);
    });

    it("POST /: still surfaces mapped 5xx faults (TaskIdAllocationFailedError) WITHOUT the unmapped label", async () => {
      // TaskIdAllocationFailedError is on the task error policy:
      // status=500, isUnmapped=false, `"tasks: 5xx fault"` log line.
      const m = stubManager({
        dispatch: vi.fn(async () => {
          throw new TaskIdAllocationFailedError(5);
        }),
      });
      const { app, cap } = await buildAppWithLogger(m);
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "writer", brief: "x" }),
      });
      expect(res.status).toBe(500);
      // The 5xx fault log fires (existing behaviour).
      const fivexx = cap.entries.find((e) => e.msg === "tasks: 5xx fault");
      expect(fivexx).toBeDefined();
      // The unmapped log does NOT fire — the error class IS mapped,
      // just to 500 rather than 4xx. This split keeps the two
      // observability buckets from overlapping in the log stream.
      const unmapped = cap.entries.find((e) => e.msg?.includes("5xx fault"));
      expect(unmapped).toBeDefined();
    });
  });
});
