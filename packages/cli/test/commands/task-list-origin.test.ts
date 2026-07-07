/**
 * `glyph task list --origin/--origin-id` — origin-scoped task listing.
 *
 * Two layers:
 *  - verb wiring (mock-fetch): the real `taskList` verb issues a GET to
 *    `/api/workspaces/<wsid>/tasks?origin=&originId=`, renders the table with
 *    an `origin: <kind>:<id>` scope header, and emits the same JSON array shape
 *    as a plain `task list` under `--json`.
 *  - argv both-or-neither (in-process `runCli`): `--origin` / `--origin-id`
 *    must be supplied together; a partial pair exits 2 before any request.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { taskList } from "../../src/commands/task.js";
import { runCli } from "../_helpers/run-cli.js";

const SERVER_URL = "http://test.local";
const WSID = "ws-abc";
const OPTS = { workspaceId: WSID, server: SERVER_URL } as const;

const WORKFLOW_TASK = {
  id: "20260601-abcd1234",
  agent: "writer",
  brief: "draft the post",
  status: "succeeded",
  origin: "workflow",
  originId: "node-7",
  metadata: {},
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
};

function stubFetch(body: unknown, status = 200): { urls: string[] } {
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { urls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("glyph task list --origin (verb wiring)", () => {
  it("GETs /tasks with the origin pair in the query and prints the scope header", async () => {
    const { urls } = stubFetch([WORKFLOW_TASK]);
    const res = await taskList({ ...OPTS, origin: "workflow", originId: "node-7" });
    expect(res.exitCode).toBe(0);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] ?? "");
    expect(url.pathname).toBe(`/api/workspaces/${WSID}/tasks`);
    expect(url.searchParams.get("origin")).toBe("workflow");
    expect(url.searchParams.get("originId")).toBe("node-7");
    // Table mode prefixes an `origin: <kind>:<id>` line so the reader knows
    // these are not standalone tasks, then the usual columns.
    expect(res.stdout ?? "").toMatch(/^origin: workflow:node-7\n/);
    expect(res.stdout ?? "").toContain("20260601-abcd1234");
    expect(res.stdout ?? "").toContain("origin");
  });

  it("--json emits the task array unchanged (no scope header)", async () => {
    stubFetch([WORKFLOW_TASK]);
    const res = await taskList({ ...OPTS, origin: "workflow", originId: "node-7", json: true });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout ?? "");
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("20260601-abcd1234");
    expect(parsed[0].origin).toBe("workflow");
    // JSON mode is identical to a plain `task list` — no `origin:` prefix.
    expect(res.stdout ?? "").not.toMatch(/^origin:/);
  });

  it("renders an empty table (no rows) when the origin has no tasks yet", async () => {
    stubFetch([]);
    const res = await taskList({ ...OPTS, origin: "workflow", originId: "never-run" });
    expect(res.exitCode).toBe(0);
    expect(res.stdout ?? "").toMatch(/^origin: workflow:never-run\n/);
  });
});

describe("glyph task list --origin/--origin-id (argv both-or-neither)", () => {
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "glyph-cli-task-origin-"));
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  function env(): Record<string, string | undefined> {
    return { GLYPH_HOME: home, GLYPH_WORKSPACE: "ws-x", GLYPH_SERVER: undefined };
  }

  it("`--origin` without `--origin-id` → exit 2 before any request", async () => {
    const r = await runCli(["task", "list", "--origin", "workflow"], env());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--origin and --origin-id must be used together/);
  });

  it("`--origin-id` without `--origin` → exit 2 before any request", async () => {
    const r = await runCli(["task", "list", "--origin-id", "node-7"], env());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--origin and --origin-id must be used together/);
  });
});
