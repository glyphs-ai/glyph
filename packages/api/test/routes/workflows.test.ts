/**
 * Route-level tests for `routes/workflows.ts`. Sibling of
 * `schedules.test.ts` — same stub-service pattern, same vitest
 * layout. Covers list, create, get, dag, cancel, and the remaining
 * coord-callback mutation surface.
 *
 * Assertion surface:
 *   - happy-path passthrough to the injected `WorkflowService` stub
 *   - input validation 400s (status query, create body shape,
 *     mutation body shapes, tagged NodeRef arms)
 *   - 404 mapping for `WorkflowNotFoundError`
 *   - 409 mapping for `WorkflowAlreadyTerminalError` /
 *     `WorkflowNodeNotMutableError`
 *   - workflow-native read-model responses (opaque node specs, ISO
 *     timestamps forwarded verbatim)
 *   - cancel response is the post-cancel header (second getWorkflow)
 *   - addSubgraph tagged node refs are forwarded unchanged
 */

import type { TaskModule } from "@glyphs-ai/task";
import type {
  GetWorkflowNodeResponse,
  GetWorkflowResponse,
  WorkflowDagSnapshot,
  WorkflowId,
  WorkflowModule,
  WorkflowNodeId,
  WorkflowStatus,
} from "@glyphs-ai/workflow";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { workflowsRoutes } from "../../src/routes/workflows.js";
import {
  WorkflowCoordAgentNotCapableError,
  WorkflowCoordSpecError,
} from "../../src/wiring/workflow-coord-task-runner.js";

// ─── Fixtures ────────────────────────────────────────────────────────

const WID = "20260607-aabbccdd" as WorkflowId;
const COORD_NID = "550e8400-e29b-41d4-a716-446655440001" as WorkflowNodeId;
const WORKER_NID = "550e8400-e29b-41d4-a716-446655440002" as WorkflowNodeId;
const NEW_NID = "550e8400-e29b-41d4-a716-446655440099" as WorkflowNodeId;

function makeHeaderView(
  overrides: Partial<{ status: WorkflowStatus; endedAt: string }> = {},
): GetWorkflowResponse {
  const status = (overrides.status ?? "running") as WorkflowStatus;
  return {
    id: WID,
    brief: "ship feature X",
    coordinatorAgent: "coord-agent",
    status,
    origin: "standalone",
    metadata: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    startedAt: "2026-06-07T00:00:00.000Z",
    ...(overrides.endedAt !== undefined ? { endedAt: overrides.endedAt } : {}),
    ...(status === "succeeded" ? { success: { output: null } } : {}),
    ...(status === "failed"
      ? { failure: { kind: "coordinator" as const, message: "coordinator finished" } }
      : {}),
    ...(status === "cancelled" ? { cancellation: { kind: "user" as const, message: "" } } : {}),
  };
}

function makeCoordView(): GetWorkflowNodeResponse {
  return {
    id: COORD_NID,
    workflowId: WID,
    kind: "coordinator",
    spec: { agent: "coord-agent" },
    phase: 0,
    status: "running",
    metadata: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    readyAt: "2026-06-07T00:00:00.000Z",
    runningAt: "2026-06-07T00:00:00.000Z",
  };
}

function makeWorkerView(): GetWorkflowNodeResponse {
  return {
    id: WORKER_NID,
    workflowId: WID,
    kind: "worker",
    spec: { agent: "writer", brief: "draft" },
    phase: 1,
    status: "not_started",
    metadata: {},
    createdAt: "2026-06-07T00:00:01.000Z",
  };
}

function makeDagView(): WorkflowDagSnapshot {
  return {
    workflow: makeHeaderView(),
    nodes: [makeCoordView(), makeWorkerView()],
    edges: [{ workflowId: WID, from: COORD_NID, to: WORKER_NID }],
  };
}

function stubUseCase<T>(response: T) {
  return { execute: vi.fn(() => okAsync(response)) };
}

function stubModule(overrides: Partial<Record<keyof WorkflowModule, unknown>>): WorkflowModule {
  const stub: Partial<Record<keyof WorkflowModule, unknown>> = {
    listWorkflows: stubUseCase([makeHeaderView()]),
    createWorkflow: stubUseCase({ workflowId: WID, initialCoordNodeId: COORD_NID }),
    getWorkflow: stubUseCase(makeHeaderView()),
    getDag: stubUseCase(makeDagView()),
    getNode: stubUseCase(makeWorkerView()),
    cancelWorkflow: stubUseCase(undefined),
    addSubgraph: stubUseCase({ insertedNodes: [] }),
    cancelNode: stubUseCase(undefined),
    finishWorkflow: stubUseCase(undefined),
    respondHumanNode: stubUseCase(makeWorkerView()),
    deleteWorkflow: stubUseCase(undefined),
    ...overrides,
  };
  return stub as unknown as WorkflowModule;
}

function stubTasks(
  overrides: Partial<{
    findTaskByWorkflowNode: (nodeId: string) => Promise<{ readonly id: string } | null>;
  }> = {},
) {
  const findTaskByWorkflowNode = overrides.findTaskByWorkflowNode ?? (async () => null);
  return {
    findTaskByWorkflowNode,
    findLatestByOrigin: {
      execute: vi.fn((req: { readonly origin: string; readonly originId: string }) => {
        expect(req.origin).toBe("workflow");
        return ResultAsync.fromPromise(
          findTaskByWorkflowNode(req.originId).then((task) =>
            task === null
              ? null
              : {
                  id: task.id,
                  agent: "writer",
                  brief: "draft",
                  origin: "workflow" as const,
                  originId: req.originId,
                  status: "succeeded" as const,
                  metadata: {},
                  createdAt: "2026-06-07T00:00:00.000Z",
                  startedAt: "2026-06-07T00:00:00.000Z",
                },
          ),
          (cause) => ({ type: "DatabaseUnavailable" as const, cause }),
        );
      }),
    },
    hasInFlightByOrigin: { execute: vi.fn(() => okAsync(false)) },
    deleteTask: { execute: vi.fn(() => okAsync(undefined)) },
  } as unknown as TaskModule & {
    findTaskByWorkflowNode: (nodeId: string) => Promise<{ readonly id: string } | null>;
  };
}

function mountRoutes(module: WorkflowModule, tasks: TaskModule = stubTasks()) {
  return workflowsRoutes(
    () => module,
    () => tasks,
    () => "C:\\glyph-test-workspace",
  );
}

// ─── GET / — list ────────────────────────────────────────────────────

describe("workflowsRoutes — list", () => {
  it("GET / returns the workflow list without api enrichment", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(WID);
    expect(body[0]).not.toHaveProperty("iterationCount");
    expect(body[0]).not.toHaveProperty("awaitingHumanCount");
    expect(body[0]?.status).toBe("running");
    expect(module.listWorkflows.execute).toHaveBeenCalledWith({ origin: ["standalone"] });
  });

  it("GET /?q=… forwards to substrate as idLike", async () => {
    const listWorkflows = stubUseCase([]);
    const module = stubModule({ listWorkflows });
    const res = await mountRoutes(module).request("/?q=abc123");
    expect(res.status).toBe(200);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      idLike: "abc123",
      origin: ["standalone"],
    });
  });

  it("GET /?coordinatorAgent=… forwards verbatim", async () => {
    const listWorkflows = stubUseCase([]);
    const module = stubModule({ listWorkflows });
    const res = await mountRoutes(module).request("/?coordinatorAgent=agent-alpha");
    expect(res.status).toBe(200);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      coordinatorAgent: "agent-alpha",
      origin: ["standalone"],
    });
  });

  it("GET /?createdSince=… forwards a parseable ISO timestamp", async () => {
    const listWorkflows = stubUseCase([]);
    const module = stubModule({ listWorkflows });
    const res = await mountRoutes(module).request(
      `/?createdSince=${encodeURIComponent("2026-06-07T00:00:00.000Z")}`,
    );
    expect(res.status).toBe(200);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      createdSince: "2026-06-07T00:00:00.000Z",
      origin: ["standalone"],
    });
  });

  it("GET /?createdSince=bogus returns 400 and does NOT call the service", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/?createdSince=not-a-date");
    expect(res.status).toBe(400);
    expect(module.listWorkflows.execute).not.toHaveBeenCalled();
  });

  it("GET / AND-combines q + coordinatorAgent + createdSince when all supplied", async () => {
    const listWorkflows = stubUseCase([]);
    const module = stubModule({ listWorkflows });
    const res = await mountRoutes(module).request(
      `/?q=abc&coordinatorAgent=agent-alpha&createdSince=${encodeURIComponent("2026-06-07T00:00:00.000Z")}`,
    );
    expect(res.status).toBe(200);
    expect(listWorkflows.execute).toHaveBeenCalledWith({
      idLike: "abc",
      coordinatorAgent: "agent-alpha",
      createdSince: "2026-06-07T00:00:00.000Z",
      origin: ["standalone"],
    });
  });

  it("GET /?status=… is no longer recognised — slot is silently ignored", async () => {
    // The wire-side `?status=` slot is silently ignored in favour of
    // client-side Running/Completed grouping. Any caller still
    // passing it gets the unfiltered list, not a 400.
    const listWorkflows = stubUseCase([]);
    const module = stubModule({ listWorkflows });
    const res = await mountRoutes(module).request("/?status=running");
    expect(res.status).toBe(200);
    expect(listWorkflows.execute).toHaveBeenCalledWith({ origin: ["standalone"] });
  });
});

// ─── POST / — create ────────────────────────────────────────────────

describe("workflowsRoutes — create", () => {
  it("POST / creates and returns 201 with the workflow read model", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "ship feature X",
        coordinatorAgent: "coord-agent",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(WID);
    expect(body).not.toHaveProperty("iterationCount");
    expect(body).not.toHaveProperty("awaitingHumanCount");
    expect(module.createWorkflow.execute).toHaveBeenCalledWith({
      brief: "ship feature X",
      coordinatorAgent: "coord-agent",
    });
    expect(module.getWorkflow.execute).toHaveBeenCalledWith({ workflowId: WID });
  });

  it("POST / forwards details when present", async () => {
    const createWorkflow = stubUseCase({ workflowId: WID, initialCoordNodeId: COORD_NID });
    const module = stubModule({ createWorkflow });
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "ship feature X",
        details: "background prose",
        coordinatorAgent: "coord-agent",
      }),
    });
    expect(res.status).toBe(201);
    expect(createWorkflow.execute).toHaveBeenCalledWith({
      brief: "ship feature X",
      coordinatorAgent: "coord-agent",
      details: "background prose",
    });
  });

  it("POST / with missing brief returns 400", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinatorAgent: "coord-agent" }),
    });
    expect(res.status).toBe(400);
    expect(module.createWorkflow.execute).not.toHaveBeenCalled();
  });

  it("POST / with unknown key returns 400", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "x",
        coordinatorAgent: "y",
        bogus: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/bogus/);
  });

  it("POST / with a metadata key returns 400 (no longer a caller-facing input)", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "x",
        coordinatorAgent: "y",
        metadata: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("ValidationError");
    expect(JSON.stringify(body.issues)).toMatch(/metadata/);
    expect(module.createWorkflow.execute).not.toHaveBeenCalled();
  });

  it("POST / with non-object body returns 400", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["hi"]),
    });
    expect(res.status).toBe(400);
  });

  // A coord runner WorkflowCoordAgentNotCapableError thrown
  // inside createWorkflow MUST map to a structured 4xx with a
  // field-pin envelope, never to a 500. The dashboard renders the
  // body inline next to the coord-agent select via the `field`
  // pointer.
  it("POST / maps WorkflowCoordAgentNotCapableError to a structured 400 (never 500)", async () => {
    const createWorkflow = {
      execute: vi.fn(() =>
        errAsync({
          type: "NodeSpecError" as const,
          nodeKind: "coordinator" as const,
          reason: "coordinator agent is not capable",
          cause: new WorkflowCoordAgentNotCapableError("official/engineer"),
        }),
      ),
    };
    const module = stubModule({ createWorkflow });
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "ship feature X",
        coordinatorAgent: "official/engineer",
      }),
    });
    expect(res.status).toBe(400);
    // Regression: a substrate-thrown capability error must never
    // reach the framework's generic 500 handler.
    expect(res.status).not.toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowCoordAgentNotCapableError");
    expect(body.field).toBe("coordinatorAgent");
    expect(body.agent).toBe("official/engineer");
    expect(typeof body.error).toBe("string");
    expect(body.error as string).toContain("official/engineer");
    expect(body.error as string).toMatch(/dispatch menu|dependencies\.agents/);
  });

  // Sibling of the capability-error test above. The coord runner's
  // strict-shape guards (non-object spec / missing-or-empty `agent` /
  // unknown key) return typed 400s via the workflows error policy and
  // SAFE_ERROR_NAMES allow-list, so the message survives.
  it("POST / maps WorkflowCoordSpecError to a 400 (never 500)", async () => {
    const createWorkflow = {
      execute: vi.fn(() =>
        errAsync({
          type: "NodeSpecError" as const,
          nodeKind: "coordinator" as const,
          reason: "Coord node spec requires non-empty agent",
          cause: new WorkflowCoordSpecError("Coord node spec requires non-empty agent"),
        }),
      ),
    };
    const module = stubModule({ createWorkflow });
    const res = await mountRoutes(module).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: "ship feature X",
        coordinatorAgent: "official/engineer",
      }),
    });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowCoordSpecError");
    expect(body.error).toBe("Coord node spec requires non-empty agent");
  });
});

// ─── GET /:wfid — header ────────────────────────────────────────────

describe("workflowsRoutes — get", () => {
  it("GET /:wfid returns the workflow read model directly", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request(`/${WID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(WID);
    expect(body).not.toHaveProperty("iterationCount");
    expect(body).not.toHaveProperty("awaitingHumanCount");
    expect(module.getWorkflow.execute).toHaveBeenCalledWith({ workflowId: WID });
  });

  it("GET /:wfid maps WorkflowNotFoundError to 404 with typed envelope", async () => {
    const module = stubModule({
      getWorkflow: {
        execute: vi.fn(() => errAsync({ type: "WorkflowNotFound" as const, workflowId: WID })),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowNotFound");
  });
});

// ─── GET /:wfid/dag — full snapshot ─────────────────────────────────

describe("workflowsRoutes — dag", () => {
  it("GET /:wfid/dag returns the workflow-native DAG snapshot", async () => {
    const module = stubModule({});
    const res = await mountRoutes(module).request(`/${WID}/dag`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workflow: Record<string, unknown>;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    expect(body.workflow.id).toBe(WID);
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toEqual([{ workflowId: WID, from: COORD_NID, to: WORKER_NID }]);

    const coordNode = body.nodes.find((n) => n.id === COORD_NID);
    expect(coordNode?.kind).toBe("coordinator");
    expect(coordNode?.spec).toEqual({ agent: "coord-agent" });

    const workerNode = body.nodes.find((n) => n.id === WORKER_NID);
    expect(workerNode?.kind).toBe("worker");
    expect(workerNode?.spec).toEqual({ agent: "writer", brief: "draft" });
  });

  it("GET /:wfid/dag maps WorkflowNotFoundError to 404", async () => {
    const module = stubModule({
      getDag: {
        execute: vi.fn(() => errAsync({ type: "WorkflowNotFound" as const, workflowId: WID })),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/dag`);
    expect(res.status).toBe(404);
  });

  it("GET /:wfid/dag does not enrich nodes with taskId", async () => {
    const module = stubModule({});
    const findTaskByWorkflowNode = vi.fn(async (nodeId: string) => {
      if (nodeId === WORKER_NID) return { id: "20260607-aaaa1111" };
      return null;
    });
    const tasks = stubTasks({ findTaskByWorkflowNode });
    const res = await mountRoutes(module, tasks).request(`/${WID}/dag`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: Array<Record<string, unknown>> };
    const workerNode = body.nodes.find((n) => n.id === WORKER_NID);
    const coordNode = body.nodes.find((n) => n.id === COORD_NID);
    expect(workerNode).toBeDefined();
    expect("taskId" in (workerNode ?? {})).toBe(false);
    expect(coordNode).toBeDefined();
    expect("taskId" in (coordNode ?? {})).toBe(false);
    expect(findTaskByWorkflowNode).not.toHaveBeenCalled();
  });
});

// ─── GET /:wfid/nodes/:nid — single node lookup ─────────────────────

describe("workflowsRoutes — getNode", () => {
  it("GET /:wfid/nodes/:nid returns the workflow-native node read model", async () => {
    const module = stubModule({
      getNode: stubUseCase(makeWorkerView()),
    });
    const findTaskByWorkflowNode = vi.fn(async (nid: string) => {
      if (nid === WORKER_NID) return { id: "20260607-bbbb2222" };
      return null;
    });
    const tasks = stubTasks({ findTaskByWorkflowNode });
    const res = await mountRoutes(module, tasks).request(`/${WID}/nodes/${WORKER_NID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(WORKER_NID);
    expect(body.workflowId).toBe(WID);
    expect(body.kind).toBe("worker");
    expect(body.spec).toEqual({ agent: "writer", brief: "draft" });
    expect(body).not.toHaveProperty("taskId");
    expect(module.getNode.execute).toHaveBeenCalledWith({ workflowId: WID, nodeId: WORKER_NID });
    expect(findTaskByWorkflowNode).not.toHaveBeenCalled();
  });

  it("GET /:wfid/nodes/:nid maps WorkflowNodeNotFoundError to 404", async () => {
    const module = stubModule({
      getNode: {
        execute: vi.fn(() =>
          errAsync({ type: "WorkflowNodeNotFound" as const, workflowId: WID, nodeId: WORKER_NID }),
        ),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/nodes/${WORKER_NID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowNodeNotFound");
  });

  it("GET /:wfid/nodes/:nid passes workflowId so the domain can enforce membership", async () => {
    const getNode = {
      execute: vi.fn((req: { readonly workflowId: string; readonly nodeId: string }) =>
        req.workflowId === WID
          ? okAsync(makeWorkerView())
          : errAsync({
              type: "WorkflowNodeNotFound" as const,
              workflowId: req.workflowId as WorkflowId,
              nodeId: req.nodeId as WorkflowNodeId,
            }),
      ),
    };
    const module = stubModule({ getNode });
    const res = await mountRoutes(module).request(`/some-other-wfid/nodes/${WORKER_NID}`);
    expect(res.status).toBe(404);
    expect(getNode.execute).toHaveBeenCalledWith({
      workflowId: "some-other-wfid",
      nodeId: WORKER_NID,
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowNodeNotFound");
  });
});

// ─── POST /:wfid/cancel ─────────────────────────────────────────────

describe("workflowsRoutes — cancel", () => {
  it("POST /:wfid/cancel calls cancelWorkflow and returns the post-cancel header", async () => {
    const cancelWorkflow = stubUseCase(undefined);
    const cancelledWorkflow = makeHeaderView({
      status: "cancelled",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const getWorkflow = stubUseCase(cancelledWorkflow);
    const module = stubModule({ cancelWorkflow, getWorkflow });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellation: { kind: "user", message: "operator stopped" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(WID);
    expect(body.status).toBe("cancelled");
    expect(body.endedAt).toBe("2026-06-07T01:00:00.000Z");
    // The validator normalizes the omitted `kind` slot to "user" once
    // at the boundary, and the route hands the validated value to the
    // service unchanged (no second `?? "user"` defense at the call
    // site). This case proves the validator-side normalization is the
    // single source of truth, so omitted-kind requests still reach the
    // service as `{ kind: "user", ... }`.
    expect(cancelWorkflow.execute).toHaveBeenCalledWith({
      workflowId: WID,
      cancellation: { kind: "user", message: "operator stopped" },
    });
    expect(getWorkflow.execute).toHaveBeenCalledWith({ workflowId: WID });
  });

  it("POST /:wfid/cancel passes an explicit { kind: 'user' } through unchanged", async () => {
    // Pair to the omitted-kind test above. Explicit `kind: "user"`
    // is the only legal value the validator accepts (line 453: any
    // other value is a 400). This test pins that semantic — both
    // the explicit and the implicit case land at the service as
    // `{ kind: "user", message }`.
    const cancelWorkflow = stubUseCase(undefined);
    const cancelledWorkflow = makeHeaderView({
      status: "cancelled",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const getWorkflow = stubUseCase(cancelledWorkflow);
    const module = stubModule({ cancelWorkflow, getWorkflow });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellation: { kind: "user", message: "boss said stop" } }),
    });
    expect(res.status).toBe(200);
    expect(cancelWorkflow.execute).toHaveBeenCalledWith({
      workflowId: WID,
      cancellation: { kind: "user", message: "boss said stop" },
    });
  });

  it("POST /:wfid/cancel maps WorkflowNotFoundError to 404", async () => {
    const module = stubModule({
      cancelWorkflow: {
        execute: vi.fn(() => errAsync({ type: "WorkflowNotFound" as const, workflowId: WID })),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellation: { kind: "user", message: "" } }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:wfid/cancel maps WorkflowAlreadyTerminalError to 409", async () => {
    const module = stubModule({
      cancelWorkflow: {
        execute: vi.fn(() =>
          errAsync({
            type: "WorkflowAlreadyTerminal" as const,
            workflowId: WID,
            status: "cancelled" as const,
          }),
        ),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellation: { kind: "user", message: "" } }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowAlreadyTerminal");
  });

  it("POST /:wfid/cancel rejects unknown top-level body keys with 400", async () => {
    const module = stubModule({ cancelWorkflow: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "unsupported" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:wfid/cancel rejects missing cancellation with 400", async () => {
    const module = stubModule({ cancelWorkflow: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ───coord-callback mutation surface ───────────────────────────

describe("workflowsRoutes — addSubgraph (POST /:wfid/subgraph)", () => {
  it("forwards tagged existing NodeRef arms unchanged", async () => {
    const addSubgraph = stubUseCase({
      insertedNodes: [{ tempId: "t1", nodeId: NEW_NID, phase: 2 }],
    });
    const module = stubModule({ addSubgraph });
    const res = await mountRoutes(module).request(`/${WID}/subgraph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [{ tempId: "t1", kind: "worker", spec: { agent: "writer" } }],
        edges: [{ from: { kind: "existing", id: COORD_NID }, to: { kind: "temp", tempId: "t1" } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { insertedNodes: Array<Record<string, unknown>> };
    expect(body.insertedNodes).toEqual([{ tempId: "t1", nodeId: NEW_NID, phase: 2 }]);
    expect(addSubgraph.execute).toHaveBeenCalledWith({
      workflowId: WID,
      nodes: [{ tempId: "t1", kind: "worker", spec: { agent: "writer" } }],
      edges: [
        {
          from: { kind: "existing", id: COORD_NID },
          to: { kind: "temp", tempId: "t1" },
        },
      ],
    });
  });

  it("forwards tagged temp NodeRef arms unchanged", async () => {
    const addSubgraph = stubUseCase({
      insertedNodes: [
        { tempId: "t1", nodeId: "n1", phase: 2 },
        { tempId: "t2", nodeId: "n2", phase: 3 },
      ],
    });
    const module = stubModule({ addSubgraph });
    const res = await mountRoutes(module).request(`/${WID}/subgraph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [
          { tempId: "t1", kind: "worker", spec: {}, existingParents: [COORD_NID] },
          { tempId: "t2", kind: "worker", spec: {} },
        ],
        edges: [{ from: { kind: "temp", tempId: "t1" }, to: { kind: "temp", tempId: "t2" } }],
      }),
    });
    expect(res.status).toBe(200);
    expect(addSubgraph.execute).toHaveBeenCalledWith({
      workflowId: WID,
      nodes: [
        { tempId: "t1", kind: "worker", spec: {}, existingParents: [COORD_NID] },
        { tempId: "t2", kind: "worker", spec: {} },
      ],
      edges: [
        {
          from: { kind: "temp", tempId: "t1" },
          to: { kind: "temp", tempId: "t2" },
        },
      ],
    });
  });

  it("rejects an untagged edge ref with 400", async () => {
    const module = stubModule({ addSubgraph: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/subgraph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [{ tempId: "t1", kind: "worker", spec: {} }],
        edges: [{ from: { nodeId: COORD_NID }, to: { tempId: "t1" } }],
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("workflowsRoutes — cancelNode (POST /:wfid/nodes/:nid/cancel)", () => {
  it("forwards (workflowId, nodeId) and returns the post-cancel node", async () => {
    const cancelNode = stubUseCase(undefined);
    const cancelledWorker: GetWorkflowNodeResponse = {
      id: WORKER_NID,
      workflowId: WID,
      kind: "worker",
      spec: { agent: "writer", brief: "draft" },
      phase: 1,
      status: "cancelled",
      metadata: {},
      createdAt: "2026-06-07T00:00:01.000Z",
      readyAt: "2026-06-07T00:00:02.000Z",
      runningAt: "2026-06-07T00:00:03.000Z",
      endedAt: "2026-06-07T00:00:04.000Z",
    };
    const module = stubModule({
      cancelNode,
      getNode: stubUseCase(cancelledWorker),
    });
    const res = await mountRoutes(module).request(`/${WID}/nodes/${WORKER_NID}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(WORKER_NID);
    expect(body.status).toBe("cancelled");
    expect(body.endedAt).toBe("2026-06-07T00:00:04.000Z");
    expect(cancelNode.execute).toHaveBeenCalledWith({ workflowId: WID, nodeId: WORKER_NID });
    expect(module.getNode.execute).toHaveBeenCalledWith({ workflowId: WID, nodeId: WORKER_NID });
  });

  it("maps WorkflowNodeNotMutableError to 409 (coord-kind target)", async () => {
    const module = stubModule({
      cancelNode: {
        execute: vi.fn(() =>
          errAsync({
            type: "WorkflowNodeNotMutable" as const,
            workflowId: WID,
            nodeId: COORD_NID,
            status: "running" as const,
            verb: "cancelNode",
          }),
        ),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/nodes/${COORD_NID}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("WorkflowNodeNotMutable");
  });
});

describe("workflowsRoutes — finish (POST /:wfid/finish)", () => {
  it("forwards outcome and returns post-finish header", async () => {
    const finishWorkflow = stubUseCase(undefined);
    const succeededWorkflow = makeHeaderView({
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const module = stubModule({
      finishWorkflow,
      getWorkflow: stubUseCase(succeededWorkflow),
    });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded", success: { output: "all good" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("succeeded");
    expect(body.endedAt).toBe("2026-06-07T01:00:00.000Z");
    expect(finishWorkflow.execute).toHaveBeenCalledWith({
      workflowId: WID,
      outcome: "succeeded",
      success: { output: "all good" },
    });
  });

  it("omits success when outcome='succeeded' and success is omitted", async () => {
    const finishWorkflow = stubUseCase(undefined);
    const succeededWorkflow = makeHeaderView({
      status: "succeeded",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const module = stubModule({
      finishWorkflow,
      getWorkflow: stubUseCase(succeededWorkflow),
    });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded" }),
    });
    expect(res.status).toBe(200);
    expect(finishWorkflow.execute).toHaveBeenCalledWith({
      workflowId: WID,
      outcome: "succeeded",
    });
  });

  it("rejects outcome='cancelled' with 400", async () => {
    const module = stubModule({ finishWorkflow: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "cancelled" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects outcome='failed' without failure with 400", async () => {
    const module = stubModule({ finishWorkflow: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "failed" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts outcome='failed' with failure.message", async () => {
    const finishWorkflow = stubUseCase(undefined);
    const failedWorkflow = makeHeaderView({
      status: "failed",
      endedAt: "2026-06-07T01:00:00.000Z",
    });
    const module = stubModule({
      finishWorkflow,
      getWorkflow: stubUseCase(failedWorkflow),
    });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome: "failed",
        failure: { kind: "coordinator", message: "budget out" },
      }),
    });
    expect(res.status).toBe(200);
    expect(finishWorkflow.execute).toHaveBeenCalledWith({
      workflowId: WID,
      outcome: "failed",
      failure: { kind: "coordinator", message: "budget out" },
    });
  });

  it("maps WorkflowAlreadyTerminalError to 409", async () => {
    const module = stubModule({
      finishWorkflow: {
        execute: vi.fn(() =>
          errAsync({
            type: "WorkflowAlreadyTerminal" as const,
            workflowId: WID,
            status: "succeeded" as const,
          }),
        ),
      },
    });
    const res = await mountRoutes(module).request(`/${WID}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "failed", failure: { kind: "coordinator", message: "x" } }),
    });
    expect(res.status).toBe(409);
  });
});

describe("workflowsRoutes — respondHumanNode (POST /:wfid/nodes/:nid/respond)", () => {
  it("forwards nested response and returns the updated node", async () => {
    const respondHumanNode = stubUseCase(makeWorkerView());
    const module = stubModule({ respondHumanNode });
    const res = await mountRoutes(module).request(`/${WID}/nodes/${WORKER_NID}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: { choiceId: "approve", input: "looks good" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("taskId");
    expect(body.spec).toEqual({ agent: "writer", brief: "draft" });
    expect(respondHumanNode.execute).toHaveBeenCalledWith({
      workflowId: WID,
      nodeId: WORKER_NID,
      response: { choiceId: "approve", input: "looks good" },
    });
  });

  it("rejects flat human responses with 400", async () => {
    const module = stubModule({ respondHumanNode: { execute: vi.fn() } });
    const res = await mountRoutes(module).request(`/${WID}/nodes/${WORKER_NID}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choiceId: "approve" }),
    });
    expect(res.status).toBe(400);
    expect(module.respondHumanNode.execute).not.toHaveBeenCalled();
  });
});
