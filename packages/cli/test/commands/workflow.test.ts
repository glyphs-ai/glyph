/**
 * `glyph workflow …` — per-subcommand tests covering the read/control
 * verbs and coordinator mutation primitives shipped by the CLI.
 *
 * Shape mirrors `schedule-patch.test.ts`: vi.spyOn the global
 * `fetch`, drive the command's pure function directly, assert on the
 * URL / method / body / exit code / stdout. Where the verb routes
 * through commander (`runCli`) it's documented inline.
 *
 * Each subcommand block covers:
 *  - happy path (200 → exit 0 with the expected stdout shape)
 *  - input validation where applicable (missing required arg → exit 2,
 *    no fetch)
 *  - server-error envelope (4xx with `error` + `code` → exit 4, typed
 *    code surfaces in stderr via `formatError`)
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  workflowAddEdge,
  workflowAddNode,
  workflowAddSubgraph,
  workflowCancel,
  workflowCancelNode,
  workflowCreate,
  workflowDag,
  workflowFinish,
  workflowList,
  workflowNodeShow,
  workflowRemoveEdge,
  workflowRemoveNode,
  workflowReplaceSpec,
  workflowRm,
  workflowShow,
} from "../../src/commands/workflow.js";
import { runCli } from "../_helpers/run-cli.js";

const SERVER_URL = "http://stub.local";
const WSID = "ws-abc";
const WFID = "20260601-aaaaaaaa";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "glyph-cli-workflow-"));
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
    const isRequest = input instanceof Request;
    const url = isRequest ? input.url : String(input);
    const method = isRequest ? input.method : String(init?.method ?? "GET");
    const rawBody = isRequest ? await input.text() : init?.body;
    let parsed: unknown;
    if (typeof rawBody === "string" && rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
    }
    calls.push({
      url,
      method,
      body: parsed,
    });
    if (r === undefined) {
      return new Response(`unexpected request #${i}: ${String(input)}`, { status: 500 });
    }
    return new Response(r.body === "" ? null : r.body, {
      status: r.status,
      headers: { "content-type": r.contentType ?? "application/json" },
    });
  });
  return { calls };
}

function commonOpts() {
  return { workspaceId: WSID, server: SERVER_URL, home };
}

const sampleHeader = {
  id: WFID,
  brief: "design the parser",
  coordinatorAgent: "official/coordinator",
  status: "running" as const,
  metadata: {},
  iterationCount: 1,
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
};

const cancelledHeader = {
  ...sampleHeader,
  status: "cancelled" as const,
  endedAt: "2026-06-01T00:05:00.000Z",
};

const LIST_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows`;
const CREATE_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows`;
const GET_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}`;
const DELETE_URL = GET_URL;
const DAG_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/dag`;
const CANCEL_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/cancel`;

// ─── list ──────────────────────────────────────────────────────────────

describe("workflowList — happy path", () => {
  it("GETs /workflows and renders a table by default", async () => {
    const { calls } = stubFetchMulti([
      {
        status: 200,
        body: JSON.stringify([sampleHeader, { ...sampleHeader, id: "wf-2", status: "succeeded" }]),
      },
    ]);
    const r = await workflowList(commonOpts());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(LIST_URL);
    // Header row + 2 data rows.
    expect(r.stdout).toContain("ID");
    expect(r.stdout).toContain("BRIEF");
    expect(r.stdout).toContain("COORDINATORAGENT");
    expect(r.stdout).toContain("STATUS");
    expect(r.stdout).toContain(WFID);
    expect(r.stdout).toContain("wf-2");
    expect(r.stdout).toContain("running");
    expect(r.stdout).toContain("succeeded");
  });

  it("--json emits the array as formatted JSON", async () => {
    stubFetchMulti([{ status: 200, body: JSON.stringify([sampleHeader]) }]);
    const r = await workflowList({ ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as ReadonlyArray<{ id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(WFID);
  });
});

describe("workflowList — server error envelope", () => {
  it("400 with typed code surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 400,
        body: JSON.stringify({ error: "bad status", code: "WorkflowError" }),
      },
    ]);
    const r = await workflowList(commonOpts());
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/WorkflowError/);
    expect(r.stderr).toMatch(/HTTP 400/);
  });
});

describe("workflowList — filter flags map to HTTP query slots", () => {
  it("--q is forwarded as the wire `q` query param", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([]) }]);
    const r = await workflowList({ ...commonOpts(), q: "20260601" });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.url).toBe(`${LIST_URL}?q=20260601`);
  });

  it("--coordinator-agent is forwarded as `coordinatorAgent`", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([]) }]);
    const r = await workflowList({
      ...commonOpts(),
      coordinatorAgent: "official/coordinator",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.url).toBe(`${LIST_URL}?coordinatorAgent=official%2Fcoordinator`);
  });

  it("--created-since is forwarded as `createdSince`", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([]) }]);
    const r = await workflowList({
      ...commonOpts(),
      createdSince: "2026-06-01T00:00:00.000Z",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.url).toBe(`${LIST_URL}?createdSince=2026-06-01T00%3A00%3A00.000Z`);
  });

  it("all three slots combine in one query string when supplied together", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([]) }]);
    const r = await workflowList({
      ...commonOpts(),
      q: "abc",
      coordinatorAgent: "official/coordinator",
      createdSince: "2026-06-01T00:00:00.000Z",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    // URLSearchParams preserves insertion order in the appended-query
    // string the SDK querySerializer builds; pin that order so the test
    // detects accidental shuffles (which would still be wire-equivalent
    // but would be a surprise in HTTP traces).
    expect(calls[0]?.url).toBe(
      `${LIST_URL}?q=abc&coordinatorAgent=official%2Fcoordinator&createdSince=2026-06-01T00%3A00%3A00.000Z`,
    );
  });

  it("omitted filters produce a bare list URL with no query string", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([]) }]);
    const r = await workflowList(commonOpts());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.url).toBe(LIST_URL);
    expect(calls[0]?.url).not.toContain("?");
  });
});

// ─── create ────────────────────────────────────────────────────────────

describe("workflowCreate — happy path", () => {
  it("POSTs /workflows with the full body", async () => {
    const { calls } = stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "design the parser",
      coordAgent: "official/coordinator",
      details: "Build a streaming JSON parser",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(CREATE_URL);
    expect(calls[0]?.body).toEqual({
      brief: "design the parser",
      coordinatorAgent: "official/coordinator",
      details: "Build a streaming JSON parser",
    });
    // Default output: formatted record of the created header.
    expect(r.stdout).toContain("ID");
    expect(r.stdout).toContain(WFID);
    expect(r.stdout).toContain("BRIEF");
  });

  it("omits --details from the body when absent", async () => {
    const { calls } = stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "design the parser",
      coordAgent: "official/coordinator",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      brief: "design the parser",
      coordinatorAgent: "official/coordinator",
    });
  });

  it("--json emits the header as formatted JSON", async () => {
    stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "design the parser",
      coordAgent: "official/coordinator",
      json: true,
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as { id: string };
    expect(parsed.id).toBe(WFID);
  });
});

describe("workflowCreate — validation (no fetch)", () => {
  it("missing --brief → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "",
      coordAgent: "official/coordinator",
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--brief/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing --coord-agent → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowCreate({ ...commonOpts(), brief: "do thing", coordAgent: "" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--coord-agent/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("whitespace-only --brief → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "   ",
      coordAgent: "official/coordinator",
    });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowCreate — server error envelope", () => {
  it("400 ValidationError surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 400,
        body: JSON.stringify({
          error: "coordinatorAgent must declare official/workflow-coordination",
          code: "CoordinatorAgentInvalidError",
        }),
      },
    ]);
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "do thing",
      coordAgent: "official/engineer",
    });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/CoordinatorAgentInvalidError/);
    expect(r.stderr).toMatch(/HTTP 400/);
  });
});

describe("workflowCreate — pre-resolved --details maps to CreateWorkflowRequest.details", () => {
  it("forwards the provided string verbatim as `details`", async () => {
    const longBody = "## Why\n\nSeed the parser strategy.\n\n## How\n\nSee /docs/parser.md\n";
    const { calls } = stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowCreate({
      ...commonOpts(),
      brief: "design the parser",
      coordAgent: "official/coordinator",
      details: longBody,
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      brief: "design the parser",
      coordinatorAgent: "official/coordinator",
      details: longBody,
    });
  });
});

describe("workflow create --details-file / --details (commander wiring) — file IO + mutex", () => {
  function env(): Record<string, string | undefined> {
    return {
      GLYPH_HOME: home,
      GLYPH_SERVER: SERVER_URL,
      GLYPH_WORKSPACE: undefined,
    };
  }

  it("rejects --details + --details-file with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(
      [
        "workflow",
        "create",
        "--workspace-id",
        WSID,
        "--brief",
        "x",
        "--coord-agent",
        "official/coordinator",
        "--details",
        "inline body",
        "--details-file",
        path.join(home, "anything.md"),
      ],
      env(),
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--details and --details-file are mutually exclusive/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unreadable --details-file with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(
      [
        "workflow",
        "create",
        "--workspace-id",
        WSID,
        "--brief",
        "x",
        "--coord-agent",
        "official/coordinator",
        "--details-file",
        path.join(home, "does-not-exist-details.md"),
      ],
      env(),
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/failed to read --details-file/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── show ──────────────────────────────────────────────────────────────

describe("workflowShow — happy path", () => {
  it("GETs /workflows/:wfid and formats the header as a record", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowShow(WFID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(GET_URL);
    expect(r.stdout).toContain(WFID);
    expect(r.stdout).toContain("COORDINATORAGENT");
    expect(r.stdout).toContain("official/coordinator");
  });

  it("--json emits the header as formatted JSON", async () => {
    stubFetchMulti([{ status: 200, body: JSON.stringify(sampleHeader) }]);
    const r = await workflowShow(WFID, { ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as { id: string };
    expect(parsed.id).toBe(WFID);
  });
});

describe("workflowShow — validation (no fetch)", () => {
  it("empty <workflow-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowShow("", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<workflow-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowShow — server error envelope", () => {
  it("404 WorkflowNotFoundError surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 404,
        body: JSON.stringify({
          error: `workflow "${WFID}" not found`,
          code: "WorkflowNotFoundError",
        }),
      },
    ]);
    const r = await workflowShow(WFID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/WorkflowNotFoundError/);
    expect(r.stderr).toMatch(/HTTP 404/);
  });
});

// ─── dag ───────────────────────────────────────────────────────────────

const NODE_SHOW_NID = "node-task-1";
const NODE_SHOW_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/nodes/${NODE_SHOW_NID}`;

const sampleNodeShow = {
  id: NODE_SHOW_NID,
  workflowId: WFID,
  phase: 1,
  status: "running" as const,
  spec: { kind: "worker" as const, agent: "official/engineer", brief: "implement parser" },
  createdAt: "2026-06-01T00:00:11.000Z",
  runningAt: "2026-06-01T00:00:12.000Z",
  taskId: "20260601-zzzz9999",
};

describe("workflowNodeShow — happy path", () => {
  it("GETs /workflows/:wfid/nodes/:nid and renders the node as a record", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(sampleNodeShow) }]);
    const r = await workflowNodeShow(WFID, NODE_SHOW_NID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(NODE_SHOW_URL);
    expect(r.stdout).toContain(NODE_SHOW_NID);
    expect(r.stdout).toContain("worker");
    expect(r.stdout).toContain("official/engineer");
    expect(r.stdout).toContain("20260601-zzzz9999");
  });

  it("--json emits the projected node as formatted JSON", async () => {
    stubFetchMulti([{ status: 200, body: JSON.stringify(sampleNodeShow) }]);
    const r = await workflowNodeShow(WFID, NODE_SHOW_NID, { ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as { id: string };
    expect(parsed.id).toBe(NODE_SHOW_NID);
  });
});

describe("workflowNodeShow — validation (no fetch)", () => {
  it("empty <workflow-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowNodeShow("", NODE_SHOW_NID, { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<workflow-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("empty <node-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowNodeShow(WFID, "", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<node-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowNodeShow — server error envelope", () => {
  it("404 WorkflowNodeNotFoundError surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 404,
        body: JSON.stringify({
          error: `node "${NODE_SHOW_NID}" not found in workflow "${WFID}"`,
          code: "WorkflowNodeNotFoundError",
        }),
      },
    ]);
    const r = await workflowNodeShow(WFID, NODE_SHOW_NID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/WorkflowNodeNotFoundError/);
    expect(r.stderr).toMatch(/HTTP 404/);
  });
});

const sampleDag = {
  workflow: sampleHeader,
  nodes: [
    {
      id: "node-coord-1",
      workflowId: WFID,
      phase: 0,
      status: "succeeded",
      spec: { kind: "coordinator", agent: "official/coordinator" },
      createdAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:00:10.000Z",
    },
    {
      id: "node-task-1",
      workflowId: WFID,
      phase: 1,
      status: "running",
      spec: {
        kind: "worker",
        agent: "official/engineer",
        brief: "implement parser",
      },
      createdAt: "2026-06-01T00:00:11.000Z",
      runningAt: "2026-06-01T00:00:12.000Z",
    },
  ],
  edges: [{ from: "node-coord-1", to: "node-task-1" }],
};

describe("workflowDag — happy path", () => {
  it("GETs /workflows/:wfid/dag and renders nodes + edges", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(sampleDag) }]);
    const r = await workflowDag(WFID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(DAG_URL);
    // Node table headers + one row per node.
    expect(r.stdout).toContain("PHASE");
    expect(r.stdout).toContain("NODEID");
    expect(r.stdout).toContain("KIND");
    expect(r.stdout).toContain("AGENT");
    expect(r.stdout).toContain("node-coord-1");
    expect(r.stdout).toContain("node-task-1");
    expect(r.stdout).toContain("official/coordinator");
    expect(r.stdout).toContain("official/engineer");
    // Edges section.
    expect(r.stdout).toContain("edges:");
    expect(r.stdout).toContain("node-coord-1 → node-task-1");
  });

  it("zero edges → '(no edges)' placeholder", async () => {
    const dagNoEdges = { ...sampleDag, edges: [] };
    stubFetchMulti([{ status: 200, body: JSON.stringify(dagNoEdges) }]);
    const r = await workflowDag(WFID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("(no edges)");
  });

  it("--json emits the full DAG snapshot as formatted JSON", async () => {
    stubFetchMulti([{ status: 200, body: JSON.stringify(sampleDag) }]);
    const r = await workflowDag(WFID, { ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as {
      workflow: { id: string };
      nodes: ReadonlyArray<unknown>;
      edges: ReadonlyArray<unknown>;
    };
    expect(parsed.workflow.id).toBe(WFID);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });
});

describe("workflowDag — validation (no fetch)", () => {
  it("empty <workflow-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowDag("", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<workflow-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowDag — server error envelope", () => {
  it("404 WorkflowNotFoundError surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 404,
        body: JSON.stringify({
          error: `workflow "${WFID}" not found`,
          code: "WorkflowNotFoundError",
        }),
      },
    ]);
    const r = await workflowDag(WFID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/WorkflowNotFoundError/);
  });
});

// ─── cancel ────────────────────────────────────────────────────────────

describe("workflowCancel — happy path", () => {
  it("POSTs /workflows/:wfid/cancel with cancellation payload body (v2.2)", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(cancelledHeader) }]);
    const r = await workflowCancel(WFID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(CANCEL_URL);
    // v2.2 always sends a body; --message omitted → empty string.
    expect(calls[0]?.body).toEqual({
      cancellation: { kind: "user", message: "" },
    });
    expect(r.stdout).toContain(`workflow ${WFID} cancelled`);
    expect(r.stdout).toContain("STATUS");
    expect(r.stdout).toContain("cancelled");
  });

  it("--message is sent on the wire as cancellation.message (v2.2)", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(cancelledHeader) }]);
    const r = await workflowCancel(WFID, { ...commonOpts(), message: "user pressed stop" });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      cancellation: { kind: "user", message: "user pressed stop" },
    });
  });

  it("--kind=user is accepted (the only kind v2.2 emits)", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(cancelledHeader) }]);
    const r = await workflowCancel(WFID, { ...commonOpts(), kind: "user", message: "stop" });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      cancellation: { kind: "user", message: "stop" },
    });
  });

  it("--json emits the post-cancel header as formatted JSON (no confirmation line)", async () => {
    stubFetchMulti([{ status: 200, body: JSON.stringify(cancelledHeader) }]);
    const r = await workflowCancel(WFID, { ...commonOpts(), json: true });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout ?? "") as { id: string; status: string };
    expect(parsed.id).toBe(WFID);
    expect(parsed.status).toBe("cancelled");
    // Confirmation prose is suppressed in JSON mode to keep the
    // output a clean parseable object.
    expect(r.stdout).not.toContain(`workflow ${WFID} cancelled`);
  });
});

describe("workflowCancel — validation (no fetch)", () => {
  it("empty <workflow-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowCancel("", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<workflow-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("--kind other than 'user' → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowCancel(WFID, { ...commonOpts(), kind: "cascade" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--kind/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowCancel — server error envelope", () => {
  it("409 InvalidTransition surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 409,
        body: JSON.stringify({
          error: "workflow already terminal",
          code: "InvalidTransition",
        }),
      },
    ]);
    const r = await workflowCancel(WFID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/InvalidTransition/);
    expect(r.stderr).toMatch(/HTTP 409/);
  });
});

// ─── rm ─────────────────────────────────────────────────────────────────

describe("workflowRm — happy path", () => {
  it("DELETEs /workflows/:wfid and exits 0 on 204", async () => {
    const { calls } = stubFetchMulti([{ status: 204, body: "" }]);
    const r = await workflowRm(WFID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(DELETE_URL);
    expect(calls[0]?.body).toBeUndefined();
    expect(r.stdout).toBe(`workflow ${WFID} removed\n`);
  });

  it("--purge forwards purge=1", async () => {
    const { calls } = stubFetchMulti([{ status: 204, body: "" }]);
    const r = await workflowRm(WFID, { ...commonOpts(), purge: true });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(`${DELETE_URL}?purge=1`);
    expect(r.stdout).toBe(`workflow ${WFID} removed (purged)\n`);
  });
});

describe("workflowRm — validation (no fetch)", () => {
  it("empty <workflow-id> → exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowRm("", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/<workflow-id>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("workflowRm — server error envelope", () => {
  it("409 WorkflowDeleteRequiresTerminalError surfaces via formatError (exit 4)", async () => {
    stubFetchMulti([
      {
        status: 409,
        body: JSON.stringify({
          error: "workflow must be terminal before delete",
          code: "WorkflowDeleteRequiresTerminalError",
          transition: "delete",
        }),
      },
    ]);
    const r = await workflowRm(WFID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/WorkflowDeleteRequiresTerminalError/);
    expect(r.stderr).toMatch(/HTTP 409/);
  });
});

// ─── commander wiring (argv → action) ──────────────────────────────────

describe("`glyph workflow …` commander wiring (argv → action)", () => {
  function env(): Record<string, string | undefined> {
    return {
      GLYPH_HOME: home,
      GLYPH_SERVER: SERVER_URL,
      GLYPH_WORKSPACE: undefined,
    };
  }

  it("`workflow list --workspace-id …` routes through commander to a GET", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([sampleHeader]) }]);
    const r = await runCli(["workflow", "list", "--workspace-id", WSID], env());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(LIST_URL);
  });

  it("`workflow rm <workflow-id>` routes through commander to DELETE", async () => {
    const { calls } = stubFetchMulti([{ status: 204, body: "" }]);
    const r = await runCli(["workflow", "rm", "--workspace-id", WSID, WFID], env());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(DELETE_URL);
  });

  it("`workflow create --brief --coord-agent` routes through commander to a POST with mapped body", async () => {
    const { calls } = stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await runCli(
      [
        "workflow",
        "create",
        "--workspace-id",
        WSID,
        "--brief",
        "design the parser",
        "--coord-agent",
        "official/coordinator",
      ],
      env(),
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      brief: "design the parser",
      coordinatorAgent: "official/coordinator",
    });
  });

  it("`workflow cancel <workflow-id> --message` routes through commander; --message is sent on the wire", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(cancelledHeader) }]);
    const r = await runCli(
      ["workflow", "cancel", "--workspace-id", WSID, WFID, "--message", "user pressed stop"],
      env(),
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(CANCEL_URL);
    expect(calls[0]?.body).toEqual({
      cancellation: { kind: "user", message: "user pressed stop" },
    });
  });

  it("`workflow list --q --coordinator-agent --created-since` routes through commander to a GET with all three slots", async () => {
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify([sampleHeader]) }]);
    const r = await runCli(
      [
        "workflow",
        "list",
        "--workspace-id",
        WSID,
        "--q",
        "20260601",
        "--coordinator-agent",
        "official/coordinator",
        "--created-since",
        "2026-06-01T00:00:00.000Z",
      ],
      env(),
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      `${LIST_URL}?q=20260601&coordinatorAgent=official%2Fcoordinator&createdSince=2026-06-01T00%3A00%3A00.000Z`,
    );
  });

  it("`workflow create --details-file` routes through commander; details lands on the body verbatim", async () => {
    const detailsFile = path.join(home, `cli-details-${Math.random().toString(36).slice(2)}.md`);
    const body = "## Goal\n\nShip the parser.\n";
    await writeFile(detailsFile, body, "utf8");
    const { calls } = stubFetchMulti([{ status: 201, body: JSON.stringify(sampleHeader) }]);
    const r = await runCli(
      [
        "workflow",
        "create",
        "--workspace-id",
        WSID,
        "--brief",
        "design the parser",
        "--coord-agent",
        "official/coordinator",
        "--details-file",
        detailsFile,
      ],
      env(),
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      brief: "design the parser",
      coordinatorAgent: "official/coordinator",
      details: body,
    });
  });
});

// ───coord-callback mutation commands ───────────────────────────

const NID = "20260601-bbbbbbbb";
const NID2 = "20260601-cccccccc";
const NODES_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/nodes`;
const EDGES_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/edges`;
const SUBGRAPH_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/subgraph`;
const FINISH_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/finish`;
const CANCEL_NODE_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/nodes/${NID}/cancel`;
const REMOVE_NODE_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/nodes/${NID}`;
const REMOVE_EDGE_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/edges/${NID}/${NID2}`;
const REPLACE_SPEC_URL = `${SERVER_URL}/api/workspaces/${WSID}/workflows/${WFID}/nodes/${NID}/spec`;

const sampleNode = {
  id: NID,
  workflowId: WFID,
  phase: 2,
  status: "not_started" as const,
  spec: { kind: "worker" as const, agent: "writer", brief: "thing" },
  createdAt: "2026-06-01T00:00:00.000Z",
};

async function writeSpec(payload: unknown): Promise<string> {
  const filePath = path.join(home, `spec-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return filePath;
}

// ─── add-node ─────────────────────────────────────────────────────────

describe("workflowAddNode", () => {
  it("POSTs /nodes with kind + spec + parents from --spec-file and --parent-node-ids", async () => {
    const specFile = await writeSpec({ agent: "writer", brief: "draft" });
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify({ nodeId: NID, phase: 2 }) },
    ]);
    const r = await workflowAddNode(WFID, {
      ...commonOpts(),
      kind: "worker",
      specFile,
      parentNodeIds: "p1,p2",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(NODES_URL);
    expect(calls[0]?.body).toEqual({
      kind: "worker",
      spec: { agent: "writer", brief: "draft" },
      parents: ["p1", "p2"],
    });
  });

  it("rejects unknown --kind with exit 2, no fetch", async () => {
    const specFile = await writeSpec({});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowAddNode(WFID, { ...commonOpts(), kind: "evaluator", specFile });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unreadable --spec-file with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowAddNode(WFID, {
      ...commonOpts(),
      kind: "worker",
      specFile: path.join(home, "does-not-exist.json"),
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/failed to read --spec-file/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects --spec-file with malformed JSON with exit 2, no fetch", async () => {
    const badPath = path.join(home, "bad.json");
    await writeFile(badPath, "{not json", "utf8");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowAddNode(WFID, { ...commonOpts(), kind: "worker", specFile: badPath });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/JSON parse error/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("server 409 surfaces typed code via formatError (exit 4)", async () => {
    const specFile = await writeSpec({});
    stubFetchMulti([
      {
        status: 409,
        body: JSON.stringify({
          error: "workflow already terminal",
          code: "WorkflowAlreadyTerminalError",
        }),
      },
    ]);
    const r = await workflowAddNode(WFID, {
      ...commonOpts(),
      kind: "worker",
      specFile,
      parentNodeIds: "p1",
    });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("WorkflowAlreadyTerminalError");
  });
});

// ─── add-edge ─────────────────────────────────────────────────────────

describe("workflowAddEdge", () => {
  it("POSTs /edges with {fromNodeId, toNodeId} from --from-node-id / --to-node-id", async () => {
    const { calls } = stubFetchMulti([
      { status: 200, body: JSON.stringify({ fromNodeId: NID, toNodeId: NID2, toPhase: 2 }) },
    ]);
    const r = await workflowAddEdge(WFID, NID, NID2, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("toPhase 2");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(EDGES_URL);
    expect(calls[0]?.body).toEqual({ fromNodeId: NID, toNodeId: NID2 });
  });

  it("rejects missing --to-node-id with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowAddEdge(WFID, NID, "", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── add-subgraph ─────────────────────────────────────────────────────

describe("workflowAddSubgraph", () => {
  it("POSTs /subgraph with the payload read from --spec-file", async () => {
    const payload = {
      nodes: [{ tempId: "t1", kind: "worker", spec: {} }],
      edges: [{ from: { nodeId: NID }, to: { tempId: "t1" } }],
    };
    const specFile = await writeSpec(payload);
    const { calls } = stubFetchMulti([
      {
        status: 200,
        body: JSON.stringify({
          insertedNodes: [{ tempId: "t1", nodeId: NID2, phase: 3 }],
        }),
      },
    ]);
    const r = await workflowAddSubgraph(WFID, { ...commonOpts(), specFile });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(SUBGRAPH_URL);
    expect(calls[0]?.body).toEqual(payload);
    expect(r.stdout).toContain("t1");
    expect(r.stdout).toContain(NID2);
  });

  it("rejects --spec-file that isn't an object with nodes+edges arrays", async () => {
    const specFile = await writeSpec(["wrong shape"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowAddSubgraph(WFID, { ...commonOpts(), specFile });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── remove-node ──────────────────────────────────────────────────────

describe("workflowRemoveNode", () => {
  it("DELETEs /nodes/:nid and exits 0 on 204", async () => {
    const { calls } = stubFetchMulti([{ status: 204, body: "" }]);
    const r = await workflowRemoveNode(WFID, NID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(REMOVE_NODE_URL);
  });

  it("surfaces 409 WorkflowRemoveNodeOrphansChildError via exit 4", async () => {
    stubFetchMulti([
      {
        status: 409,
        body: JSON.stringify({
          error: "orphan",
          code: "WorkflowRemoveNodeOrphansChildError",
        }),
      },
    ]);
    const r = await workflowRemoveNode(WFID, NID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("WorkflowRemoveNodeOrphansChildError");
  });
});

// ─── remove-edge ──────────────────────────────────────────────────────

describe("workflowRemoveEdge", () => {
  it("DELETEs /edges/:from/:to and exits 0 on 204", async () => {
    const { calls } = stubFetchMulti([{ status: 204, body: "" }]);
    const r = await workflowRemoveEdge(WFID, NID, NID2, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(REMOVE_EDGE_URL);
  });

  it("rejects missing --from-node-id with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowRemoveEdge(WFID, "", NID2, { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── replace-spec ─────────────────────────────────────────────────────

describe("workflowReplaceSpec", () => {
  it("PATCHes /nodes/:nid/spec with {newSpec} from --spec-file", async () => {
    const specFile = await writeSpec({ agent: "writer", brief: "rev" });
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(sampleNode) }]);
    const r = await workflowReplaceSpec(WFID, NID, { ...commonOpts(), specFile });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe(REPLACE_SPEC_URL);
    expect(calls[0]?.body).toEqual({ newSpec: { agent: "writer", brief: "rev" } });
  });

  it("rejects missing --spec-file with exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowReplaceSpec(WFID, NID, { ...commonOpts(), specFile: "" });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── cancel-node ──────────────────────────────────────────────────────

describe("workflowCancelNode", () => {
  it("POSTs /nodes/:nid/cancel and renders the post-cancel node", async () => {
    const cancelled = { ...sampleNode, status: "cancelled" as const };
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(cancelled) }]);
    const r = await workflowCancelNode(WFID, NID, { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(CANCEL_NODE_URL);
    expect(r.stdout).toContain("cancelled");
  });

  it("server 409 (coord-kind target) surfaces typed code via exit 4", async () => {
    stubFetchMulti([
      {
        status: 409,
        body: JSON.stringify({ error: "not mutable", code: "WorkflowNodeNotMutableError" }),
      },
    ]);
    const r = await workflowCancelNode(WFID, NID, { ...commonOpts() });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("WorkflowNodeNotMutableError");
  });
});

// ─── finish ───────────────────────────────────────────────────────────

describe("workflowFinish", () => {
  it("POSTs /finish with {kind:'succeeded', success:{output:null}} when --summary omitted", async () => {
    const succeededHeader = {
      ...sampleHeader,
      status: "succeeded" as const,
      endedAt: "2026-06-01T01:00:00.000Z",
    };
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(succeededHeader) }]);
    const r = await workflowFinish(WFID, "succeeded", { ...commonOpts() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(FINISH_URL);
    expect(calls[0]?.body).toEqual({ kind: "succeeded", success: { output: null } });
    expect(r.stdout).toContain("succeeded");
  });

  it("forwards --summary into success.output", async () => {
    const succeededHeader = {
      ...sampleHeader,
      status: "succeeded" as const,
      endedAt: "2026-06-01T01:00:00.000Z",
    };
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(succeededHeader) }]);
    const r = await workflowFinish(WFID, "succeeded", {
      ...commonOpts(),
      summary: "All sub-runs green.",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      kind: "succeeded",
      success: { output: "All sub-runs green." },
    });
  });

  it("forwards --message into failure.message when outcome=failed", async () => {
    const failedHeader = {
      ...sampleHeader,
      status: "failed" as const,
      endedAt: "2026-06-01T01:00:00.000Z",
    };
    const { calls } = stubFetchMulti([{ status: 200, body: JSON.stringify(failedHeader) }]);
    const r = await workflowFinish(WFID, "failed", {
      ...commonOpts(),
      message: "budget exhausted",
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(calls[0]?.body).toEqual({
      kind: "failed",
      failure: { kind: "coordinator", message: "budget exhausted" },
    });
  });

  it("rejects --outcome=failed without --message with exit 2", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowFinish(WFID, "failed", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--message is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects --summary with --outcome=failed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowFinish(WFID, "failed", { ...commonOpts(), summary: "x", message: "y" });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects --message with --outcome=succeeded", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowFinish(WFID, "succeeded", { ...commonOpts(), message: "x" });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects --outcome=cancelled with exit 2, no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await workflowFinish(WFID, "cancelled", { ...commonOpts() });
    expect(r.exitCode).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ───break-clean: legacy id-flags are rejected by commander ────────

describe("legacy id-flags are rejected (no backward-compat)", () => {
  function env(): Record<string, string | undefined> {
    return {
      GLYPH_HOME: home,
      GLYPH_SERVER: SERVER_URL,
      GLYPH_WORKSPACE: undefined,
    };
  }

  it("`workflow show --wfid <id>` exits non-zero (commander unknown-option)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(["workflow", "show", "--workspace-id", WSID, "--wfid", WFID], env());
    expect(r.exitCode).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`workflow node-show --nid <id>` exits non-zero (commander unknown-option)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(
      ["workflow", "node-show", "--workspace-id", WSID, WFID, "--nid", NID],
      env(),
    );
    expect(r.exitCode).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`workflow add-edge --from <id> --to <id>` exits non-zero (commander unknown-option)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(
      ["workflow", "add-edge", "--workspace-id", WSID, WFID, "--from", NID, "--to", NID2],
      env(),
    );
    expect(r.exitCode).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`workflow add-node --parents <ids>` exits non-zero (commander unknown-option)", async () => {
    const specFile = await writeSpec({ agent: "writer", brief: "draft" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(
      [
        "workflow",
        "add-node",
        "--workspace-id",
        WSID,
        WFID,
        "--kind",
        "worker",
        "--spec-file",
        specFile,
        "--parents",
        "p1,p2",
      ],
      env(),
    );
    expect(r.exitCode).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("`workflow show --workspace <id>` exits non-zero (--workspace renamed to --workspace-id)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runCli(["workflow", "show", "--workspace", WSID, WFID], env());
    expect(r.exitCode).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
