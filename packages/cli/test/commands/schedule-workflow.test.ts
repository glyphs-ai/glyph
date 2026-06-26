/**
 * `glyph schedule create-workflow` / `patch-workflow` / `list-workflows`
 * plus the workflow-kind row in the general `schedule list` table.
 *
 * Drives the command functions directly with a `vi.spyOn(globalThis,
 * "fetch")` stub (the `stubFetchMulti` pattern from
 * `schedule-patch.test.ts`) so the real request-building code runs —
 * URL, method, and JSON body are all asserted against the wire contract.
 *
 * Covers the workflow-kind half of the schedules CLI surface that the
 * task-kind tests don't reach:
 *   - create: required-flag validation (exitCode 2, no network) + the
 *     `{ target: { coordinatorAgent, brief } }` POST shape
 *   - patch: sparse `target` (no GET), `--clear-details` → `null`, and
 *     the one remaining GET-merge case (partial trigger update)
 *   - list-workflows: table + `?scheduleId=` narrow + json passthrough
 *   - list: a workflow-kind schedule surfaces `coordinatorAgent` in the
 *     agent column (the kind-discriminated projection)
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  scheduleCreateWorkflow,
  scheduleList,
  scheduleListWorkflows,
  schedulePatchWorkflow,
} from "../../src/commands/schedule.js";

const SERVER_URL = "http://stub.local";
const WSID = "ws-abc";
const SID = "20260601-aaaaaaaa";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "glyph-cli-schedule-workflow-"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

interface MockResponse {
  status: number;
  body: string;
  contentType?: string;
}

function stubFetchMulti(responses: readonly MockResponse[]): { calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const r = responses[i];
    i += 1;
    const rawBody = init?.body;
    let parsed: unknown;
    if (typeof rawBody === "string" && rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
    }
    calls.push({
      url: String(input),
      method: String(init?.method ?? "GET"),
      body: parsed,
    });
    if (r === undefined) {
      return new Response(`unexpected request #${i}: ${String(input)}`, { status: 500 });
    }
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": r.contentType ?? "application/json" },
    });
  });
  return { calls };
}

const sampleWorkflowSchedule = {
  id: SID,
  name: "Nightly Build",
  trigger: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
  target: {
    kind: "workflow",
    coordinatorAgent: "official/architect",
    brief: "ship the nightly",
    details: "Long-form coordinator brief.",
  },
  enabled: true,
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

const sampleWorkflowScheduleGet = { ...sampleWorkflowSchedule, describe: "every day at 9" };

function commonOpts() {
  return { workspaceId: WSID, server: SERVER_URL, home };
}

const CREATE_URL = `${SERVER_URL}/api/workspaces/${WSID}/schedules/workflow`;
const PATCH_URL = `${SERVER_URL}/api/workspaces/${WSID}/schedules/workflow/${SID}`;
const GET_URL = `${SERVER_URL}/api/workspaces/${WSID}/schedules/${SID}`;
const LIST_WF_URL = `${SERVER_URL}/api/workspaces/${WSID}/scheduled-workflows`;
const SCHEDULES_URL = `${SERVER_URL}/api/workspaces/${WSID}/schedules`;

// ─── create-workflow ─────────────────────────────────────────────────────

describe("scheduleCreateWorkflow — POST shape", () => {
  it("issues exactly 1 POST with the workflow target envelope", async () => {
    const { calls } = stubFetchMulti([
      { status: 201, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await scheduleCreateWorkflow({
      ...commonOpts(),
      name: "Nightly Build",
      coordAgent: "official/architect",
      brief: "ship the nightly",
      cron: "0 9 * * *",
      tz: "Asia/Shanghai",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(CREATE_URL);
    expect(calls[0]?.body).toEqual({
      name: "Nightly Build",
      target: { coordinatorAgent: "official/architect", brief: "ship the nightly" },
      trigger: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
      enabled: true,
    });
  });

  it("forwards --details and trims the brief; --disabled flips enabled:false", async () => {
    const { calls } = stubFetchMulti([
      { status: 201, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await scheduleCreateWorkflow({
      ...commonOpts(),
      name: "Nightly Build",
      coordAgent: "official/architect",
      brief: "  trimmed brief  ",
      details: "multi\nline\ndetails",
      cron: "0 9 * * *",
      tz: "Asia/Shanghai",
      disabled: true,
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      name: "Nightly Build",
      target: {
        coordinatorAgent: "official/architect",
        brief: "trimmed brief",
        details: "multi\nline\ndetails",
      },
      trigger: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
      enabled: false,
    });
  });

  it.each([
    ["missing --name", { name: "" }, "missing required --name"],
    ["missing --coord-agent", { coordAgent: "" }, "missing required --coord-agent"],
    ["missing --brief", { brief: "" }, "missing required --brief"],
    ["multi-line --brief", { brief: "line one\nline two" }, "single line"],
    ["over-long --brief", { brief: "x".repeat(201) }, "200 characters or fewer"],
    ["missing --cron", { cron: "" }, "missing required --cron"],
    ["missing --tz", { tz: "" }, "missing required --tz"],
  ])("rejects %s with exitCode 2 and no network", async (_label, override, needle) => {
    const { calls } = stubFetchMulti([]);
    const base = {
      ...commonOpts(),
      name: "Nightly Build",
      coordAgent: "official/architect",
      brief: "ship the nightly",
      cron: "0 9 * * *",
      tz: "Asia/Shanghai",
    };
    const r = await scheduleCreateWorkflow({ ...base, ...override });
    expect(r.exitCode).toBe(2);
    expect(r.stderr ?? "").toContain(needle);
    expect(calls).toHaveLength(0);
  });
});

// ─── patch-workflow ───────────────────────────────────────────────────────

describe("schedulePatchWorkflow — partial update", () => {
  it("sparse target (coord-agent + brief) issues 1 PATCH, no GET", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await schedulePatchWorkflow(SID, {
      ...commonOpts(),
      coordAgent: "official/engineer",
      brief: "new coordinator brief",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toBe(`schedule ${SID} patched\n`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(PATCH_URL);
    expect(calls[0]?.body).toEqual({
      target: { coordinatorAgent: "official/engineer", brief: "new coordinator brief" },
    });
  });

  it("--clear-details ships target.details === null (RFC 7396 delete)", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await schedulePatchWorkflow(SID, { ...commonOpts(), clearDetails: true });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ target: { details: null } });
  });

  it("partial trigger (--cron alone) fetches GET then preserves existing tz", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify(sampleWorkflowScheduleGet) },
      { status: 200, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await schedulePatchWorkflow(SID, { ...commonOpts(), cron: "0 10 * * *" });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(GET_URL);
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.body).toEqual({
      trigger: { kind: "cron", expr: "0 10 * * *", tz: "Asia/Shanghai" },
    });
  });

  it("both --cron and --tz issues 1 PATCH with no GET", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify(sampleWorkflowSchedule) },
    ]);
    const r = await schedulePatchWorkflow(SID, {
      ...commonOpts(),
      cron: "30 8 * * *",
      tz: "UTC",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ trigger: { kind: "cron", expr: "30 8 * * *", tz: "UTC" } });
  });

  it("--details and --clear-details together is rejected (exitCode 2, no network)", async () => {
    const { calls } = stubFetchMulti([]);
    const r = await schedulePatchWorkflow(SID, {
      ...commonOpts(),
      details: "x",
      clearDetails: true,
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr ?? "").toContain("mutually exclusive");
    expect(calls).toHaveLength(0);
  });

  it("no update flags is rejected (exitCode 2, no network)", async () => {
    const { calls } = stubFetchMulti([]);
    const r = await schedulePatchWorkflow(SID, { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr ?? "").toContain("at least one of");
    expect(calls).toHaveLength(0);
  });

  it("multi-line --brief is rejected (exitCode 2, no network)", async () => {
    const { calls } = stubFetchMulti([]);
    const r = await schedulePatchWorkflow(SID, { ...commonOpts(), brief: "a\nb" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr ?? "").toContain("single line");
    expect(calls).toHaveLength(0);
  });
});

// ─── list-workflows ───────────────────────────────────────────────────────

const wfHeaderA = {
  id: "20260601-0000000a",
  coordinatorAgent: "official/architect",
  status: "running",
  brief: "alpha run",
  originId: "sched-1",
  metadata: {},
  awaitingHumanCount: 0,
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: null,
  endedAt: null,
};
const wfHeaderB = {
  id: "20260602-0000000b",
  coordinatorAgent: "official/engineer",
  status: "succeeded",
  brief: "beta run",
  originId: "sched-2",
  metadata: {},
  awaitingHumanCount: 1,
  createdAt: "2026-06-02T00:00:00.000Z",
  startedAt: null,
  endedAt: null,
};

describe("scheduleListWorkflows — table output", () => {
  it("renders id / coordinatorAgent / status / scheduleId columns", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify([wfHeaderA, wfHeaderB]) },
    ]);
    const r = await scheduleListWorkflows({ ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(LIST_WF_URL);
    const out = r.stdout ?? "";
    expect(out).toContain("20260601-0000000a");
    expect(out).toContain("official/architect");
    expect(out).toContain("running");
    expect(out).toContain("sched-1");
    expect(out).toContain("20260602-0000000b");
    expect(out).toContain("official/engineer");
    expect(out).toContain("sched-2");
  });

  it("--schedule-id narrows the query string", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([wfHeaderA]) }]);
    const r = await scheduleListWorkflows({ ...commonOpts(), scheduleId: "sched-1" });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.url).toContain("scheduleId=sched-1");
  });

  it("--json emits the raw header array", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify([wfHeaderA, wfHeaderB]) },
    ]);
    const r = await scheduleListWorkflows({ ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    const parsed = JSON.parse(r.stdout ?? "[]");
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("20260601-0000000a");
  });
});

// ─── list (general) — workflow-kind row ────────────────────────────────────

describe("scheduleList — workflow-kind projection", () => {
  it("surfaces coordinatorAgent in the agent column and 'workflow' as the kind", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify([sampleWorkflowSchedule]) },
    ]);
    const r = await scheduleList({ ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(SCHEDULES_URL);
    const out = r.stdout ?? "";
    expect(out).toContain("workflow");
    expect(out).toContain("official/architect");
    expect(out).toContain("0 9 * * *");
  });
});
