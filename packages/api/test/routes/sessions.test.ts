import type { CreateSessionResponse, SessionId } from "@glyphs-ai/session";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { sessionsRoutes } from "../../src/routes/sessions.js";
import type { WorkspaceContext } from "../../src/workspace-context.js";

/**
 * Route-level tests for `sessionsRoutes`. The session module is mocked:
 * each use-case is a `{ execute }` stub returning a `ResultAsync`, so
 * these tests pin the transport contract (query parsing, body
 * validation, status + wire `code` mapping) without booting a real
 * session store. Request-validation behaviour that lives inside a
 * use-case (e.g. malformed session id → 400) is covered end-to-end in
 * `spawn-response-shape.test.ts` against a real module.
 */

const sampleRecord: CreateSessionResponse = {
  id: "20260508-9dfbdf05" as SessionId,
  workdir: "/tmp/wd",
  agent: "demo",
  runtime: "copilot",
  runtimeSessionId: "12345678-1234-1234-1234-1234567890ab",
  createdAt: "2026-05-08T01:05:00.000Z",
  lastActiveAt: null,
  preview: null,
  lastLaunchMode: null,
};

const sampleDisplay = 'cd "/tmp/wd" && copilot --session-id=12345678-1234-1234-1234-1234567890ab';

type Sessions = WorkspaceContext["sessions"];

/**
 * Build a `SessionModule`-shaped stub. Each use-case defaults to a
 * success `ResultAsync`; `overrides` replace individual use-cases (e.g.
 * an `errAsync` to exercise an error-mapping path).
 */
function stubModule(overrides: Partial<Record<keyof Sessions, unknown>> = {}): Sessions {
  const base = {
    listSessions: { execute: vi.fn(() => okAsync([sampleRecord])) },
    createSession: { execute: vi.fn(() => okAsync(sampleRecord)) },
    getSession: { execute: vi.fn(() => okAsync(sampleRecord)) },
    deleteSession: { execute: vi.fn(() => okAsync(undefined)) },
    buildInteractiveLaunch: { execute: vi.fn(() => okAsync(undefined)) },
    spawnInteractive: {
      execute: vi.fn(() => okAsync({ ok: true, launcher: "wt", display: sampleDisplay })),
    },
    close: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as unknown as Sessions;
}

function stubContext(sessions: Sessions): WorkspaceContext {
  return { sessions } as unknown as WorkspaceContext;
}

/**
 * Read a JSON response body for assertions. api's strict tsconfig types
 * `Response.json()` as `unknown`; this casts to a loose record (or the
 * supplied shape) so field assertions typecheck without an `any`.
 */
const jsonBody = <T = Record<string, unknown>>(res: Response): Promise<T> =>
  res.json() as Promise<T>;

describe("sessionsRoutes", () => {
  it("GET / lists sessions", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/");
    expect(res.status).toBe(200);
    const body = await jsonBody<Array<Record<string, unknown>>>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.id).toBe(sampleRecord.id);
    expect(body[0]?.runtime).toBe("copilot");
    expect(m.listSessions.execute).toHaveBeenCalledWith({});
  });

  it("GET /?agent=demo passes agent filter", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/?agent=demo");
    expect(res.status).toBe(200);
    expect(m.listSessions.execute).toHaveBeenCalledWith({ agent: "demo" });
  });

  it("GET /?createdSince=ISO passes the timestamp through", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request(
      "/?createdSince=2026-05-01T00:00:00.000Z",
    );
    expect(res.status).toBe(200);
    expect(m.listSessions.execute).toHaveBeenCalledWith({
      createdSince: "2026-05-01T00:00:00.000Z",
    });
  });

  it("GET /?createdSince=garbage returns 400", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/?createdSince=not-a-date");
    expect(res.status).toBe(400);
    expect(m.listSessions.execute).not.toHaveBeenCalled();
    const body = await jsonBody(res);
    expect(body.detail).toMatch(/ISO 8601/);
  });

  it("GET /?createdSince=<non-ISO-but-parseable> normalises to canonical ISO", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/?createdSince=Jan 1 2024 UTC");
    expect(res.status).toBe(200);
    expect(m.listSessions.execute).toHaveBeenCalledWith({
      createdSince: "2024-01-01T00:00:00.000Z",
    });
  });

  it("GET /?activeSince=garbage returns 400", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/?activeSince=not-a-date");
    expect(res.status).toBe(400);
    expect(m.listSessions.execute).not.toHaveBeenCalled();
    const body = await jsonBody(res);
    expect(body.detail).toMatch(/activeSince must be an ISO 8601 timestamp/);
  });

  it("GET /?createdSince + ?activeSince combine", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request(
      "/?createdSince=2026-01-01T00:00:00.000Z&activeSince=2026-04-01T00:00:00.000Z",
    );
    expect(res.status).toBe(200);
    expect(m.listSessions.execute).toHaveBeenCalledWith({
      createdSince: "2026-01-01T00:00:00.000Z",
      activeSince: "2026-04-01T00:00:00.000Z",
    });
  });

  it("GET / surfaces DatabaseUnavailable as 503", async () => {
    const m = stubModule({
      listSessions: {
        execute: vi.fn(() => errAsync({ type: "DatabaseUnavailable", cause: null })),
      },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/");
    expect(res.status).toBe(503);
    expect((await jsonBody(res)).code).toBe("DatabaseUnavailable");
  });

  it("POST / requires JSON body", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe("ValidationError");
  });

  it("POST / requires agent string", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST / rejects unknown body fields", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "demo", workdir: "ignored" }),
    });
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toMatchObject({ code: "ValidationError" });
    expect(m.createSession.execute).not.toHaveBeenCalled();
  });

  it("POST / creates session and returns 201", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "demo" }),
    });
    expect(res.status).toBe(201);
    expect(m.createSession.execute).toHaveBeenCalledWith({ agent: "demo" });
  });

  it("POST / forwards optional runtime override", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "demo", runtime: "claude" }),
    });
    expect(res.status).toBe(201);
    expect(m.createSession.execute).toHaveBeenCalledWith({ agent: "demo", runtime: "claude" });
  });

  it("POST / maps AgentNotFound to 404", async () => {
    const m = stubModule({
      createSession: { execute: vi.fn(() => errAsync({ type: "AgentNotFound", agent: "ghost" })) },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ghost" }),
    });
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("AgentNotFound");
  });

  it("POST / maps UnknownRuntime to 400", async () => {
    const m = stubModule({
      createSession: {
        execute: vi.fn(() => errAsync({ type: "UnknownRuntime", runtime: "gemini" })),
      },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "demo", runtime: "gemini" }),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe("UnknownRuntime");
  });

  it("POST / maps RuntimeProvisionFailed to 500 (server fault, opaque body)", async () => {
    const m = stubModule({
      createSession: {
        execute: vi.fn(() =>
          errAsync({ type: "RuntimeProvisionFailed", cause: new Error("mkdir") }),
        ),
      },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "demo" }),
    });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.code).toBe("RuntimeProvisionFailed");
    expect(body.detail).toBe("internal error");
  });

  it("GET /:id returns 404 when not found", async () => {
    const m = stubModule({ getSession: { execute: vi.fn(() => okAsync(null)) } });
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05");
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe("SessionNotFound");
  });

  it("GET /:id returns the record", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05");
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).id).toBe(sampleRecord.id);
  });

  it("DELETE /:id?purge=1 propagates the purge flag (full wipe)", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05?purge=1", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(m.deleteSession.execute).toHaveBeenCalledWith({ id: "20260508-9dfbdf05", purge: true });
  });

  it("DELETE /:id without ?purge=1 archives (purge defaults to false)", async () => {
    const m = stubModule();
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(m.deleteSession.execute).toHaveBeenCalledWith({ id: "20260508-9dfbdf05", purge: false });
  });

  it("DELETE /:id is idempotent: SessionNotFound still returns 204", async () => {
    const m = stubModule({
      deleteSession: {
        execute: vi.fn(() => errAsync({ type: "SessionNotFound", id: "20260508-9dfbdf05" })),
      },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("DELETE /:id maps RuntimeStateDeletionFailed to 409", async () => {
    const m = stubModule({
      deleteSession: {
        execute: vi.fn(() =>
          errAsync({ type: "RuntimeStateDeletionFailed", cause: new Error("EBUSY") }),
        ),
      },
    });
    const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05?purge=1", {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
    expect((await jsonBody(res)).code).toBe("RuntimeStateDeletionFailed");
  });

  describe("POST /:id/spawn", () => {
    it("spawns the launch command", async () => {
      const m = stubModule();
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.launcher).toBe("wt");
      expect(body.display).toBe(sampleDisplay);
      // No body → remote defaults to false → only `{ id }` is forwarded.
      expect(m.spawnInteractive.execute).toHaveBeenCalledWith({ id: "20260508-9dfbdf05" });
    });

    it("forwards remote: true to the use-case when body sets it", async () => {
      const m = stubModule();
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remote: true }),
      });
      expect(res.status).toBe(200);
      expect(m.spawnInteractive.execute).toHaveBeenCalledWith({
        id: "20260508-9dfbdf05",
        remote: true,
      });
    });

    it("rejects a non-boolean `remote` value with 400", async () => {
      const m = stubModule();
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remote: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects unknown spawn body fields", async () => {
      const m = stubModule();
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remote: true, mode: "remote" }),
      });
      expect(res.status).toBe(400);
      expect(await jsonBody(res)).toMatchObject({ code: "ValidationError" });
      expect(m.spawnInteractive.execute).not.toHaveBeenCalled();
    });

    it("returns ok:false with display on spawn failure", async () => {
      const m = stubModule({
        spawnInteractive: {
          execute: vi.fn(() =>
            okAsync({
              ok: false,
              error: "ENOENT: terminal not found",
              code: "SpawnFailed",
              display: sampleDisplay,
            }),
          ),
        },
      });
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
      });
      // 200 because the request itself succeeded; the body carries ok:false
      // so the dashboard can distinguish "session is fine, terminal isn't".
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.ok).toBe(false);
      expect(body.display).toBe(sampleDisplay);
      expect(body.error).toMatch(/ENOENT/);
    });

    it("returns ok:false with code from the launch error on a missing session", async () => {
      const m = stubModule({
        spawnInteractive: {
          execute: vi.fn(() =>
            okAsync({
              ok: false,
              error: "session not found: 20260508-9dfbdf05",
              code: "SessionNotFound",
              display: "",
            }),
          ),
        },
      });
      const res = await sessionsRoutes(() => stubContext(m)).request("/20260508-9dfbdf05/spawn", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.ok).toBe(false);
      expect(body.code).toBe("SessionNotFound");
      expect(body.display).toBe("");
    });
  });
});
