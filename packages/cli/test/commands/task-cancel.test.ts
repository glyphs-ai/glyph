/**
 * `glyph task cancel` verb wiring + 4xx/5xx body parsing + exit-code
 * mapping.
 *
 * Mock-fetch based; no real server. Drives the real `taskCancel` verb
 * (which resolves its connection from the passed `server` / `workspaceId`
 * opts) through a `vi.spyOn(globalThis, "fetch")` stub — the SDK issues
 * `fetch(new Request(...))`, so the stub reads from the Request, not
 * `init`. Asserts:
 *  - POSTs to `/api/workspaces/<wsid>/tasks/<tid>/cancel`
 *  - 200 + Task JSON → exit 0, default stdout is the success line
 *  - `--json` → exit 0, stdout is the formatted Task JSON
 *  - 409 + structured `InvalidTransition` envelope → exit 4 with the typed
 *    code surfaced (no prose parsing)
 *  - 503 + `ManagerShuttingDownError` → exit 4 with the typed code
 *  - empty task id → exit 2 before any request
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { taskCancel } from "../../src/commands/task.js";

const SERVER_URL = "http://test.local";
const WSID = "ws-abc";
const TID = "20260601-deadbeef";
const OPTS = { workspaceId: WSID, server: SERVER_URL } as const;

interface MockResponse {
  status: number;
  body: string;
}

function stubFetch(response: MockResponse): { calls: string[] } {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const isRequest = input instanceof Request;
    const url = isRequest ? input.url : String(input);
    const method = isRequest ? input.method : String(init?.method ?? "GET");
    calls.push(`${method} ${url}`);
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const CANCELLED = {
  id: TID,
  agent: "writer",
  brief: "go",
  status: "cancelled",
  metadata: {},
  createdAt: "2026-06-01T00:00:00.000Z",
  cancellation: { kind: "user", message: "cancelled by user" },
};

describe("glyph task cancel", () => {
  it("POSTs to the cancel endpoint and prints the success line", async () => {
    const { calls } = stubFetch({ status: 200, body: JSON.stringify(CANCELLED) });
    const res = await taskCancel(TID, OPTS);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(`task ${TID} cancelled\n`);
    expect(calls).toEqual([`POST ${SERVER_URL}/api/workspaces/${WSID}/tasks/${TID}/cancel`]);
  });

  it("--json prints the cancelled Task as formatted JSON", async () => {
    stubFetch({ status: 200, body: JSON.stringify(CANCELLED) });
    const res = await taskCancel(TID, { ...OPTS, json: true });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout ?? "");
    expect(parsed.status).toBe("cancelled");
    expect(parsed.cancellation.kind).toBe("user");
  });

  it("surfaces a 409 InvalidTransition as exit 4 with the typed code", async () => {
    stubFetch({
      status: 409,
      body: JSON.stringify({
        error: 'invalid transition: cannot apply "cancel" to a task in "success"',
        code: "InvalidTransition",
        status: "success",
        transition: "cancel",
      }),
    });
    const res = await taskCancel(TID, OPTS);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toMatch(/InvalidTransition/);
    expect(res.stderr).toMatch(/HTTP 409/);
  });

  it("surfaces a 503 ManagerShuttingDown as exit 4 with the typed code", async () => {
    stubFetch({
      status: 503,
      body: JSON.stringify({
        error: "task manager is shutting down",
        code: "ManagerShuttingDown",
      }),
    });
    const res = await taskCancel(TID, OPTS);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toMatch(/ManagerShuttingDown/);
    expect(res.stderr).toMatch(/HTTP 503/);
  });
});

describe("taskCancel input validation", () => {
  it("returns exit 2 when the task id is empty (before any request)", async () => {
    const res = await taskCancel("");
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/task id is required/);
  });
});
