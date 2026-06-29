/**
 * Unit tests for `makeWorkflowKindHandler`. This is the sole module
 * that knows about all of `@glyphs-ai/schedule`, `@glyphs-ai/workflow`,
 * `@glyphs-ai/task`, and `@glyphs-ai/catalog` — see
 * `../../src/wiring/schedule-workflow-handler.ts`. Covers:
 *
 *   - `validate(data)` shape checks (coordinatorAgent / brief / details)
 *   - coord-eligibility (the agent must declare a non-empty
 *     `dependencies.agents` dispatch menu)
 *   - `validate(data, { changedKeys })` SKIPs the catalog lookup when
 *     `coordinatorAgent` is not in `changedKeys` (patch-when-catalog-down)
 *   - `validate` throws `WorkflowScheduleTargetError` on unknown /
 *     not-coord-eligible agent, but `AgentResolutionFailedError` (→ 500
 *     opaque) when the catalog itself throws (infra, not bad input)
 *   - `mergePatch` RFC 7396 semantics + `changedKeys` accuracy
 *   - `dispatch` synthesises `originId: scheduleId` + `metadata: { firedAt }`,
 *     conditional-spreads `details`, returns `{ id }`
 *   - `hasInFlightForSchedule` true only for `running` workflows of the
 *     schedule
 *   - `deleteForSchedule` cascades each terminal run's node-backing
 *     tasks (with workdir purge) + purges the workflow dir, skips runs
 *     with an in-flight node task, and leaves other schedules' runs
 *     untouched
 */

import { AgentResolutionFailedError, type TaskService } from "@glyphs-ai/task";
import type { WorkflowService } from "@glyphs-ai/workflow";
import { describe, expect, it, vi } from "vitest";
import {
  makeWorkflowKindHandler,
  WorkflowScheduleTargetError,
} from "../../src/wiring/schedule-workflow-handler.js";

type CatalogAgentLookup = Parameters<typeof makeWorkflowKindHandler>[0]["catalog"];

const COORD_OK = { name: "coord", dependencies: { agents: ["worker"] } };

interface WfStub {
  id: string;
  status: string;
  originId?: string;
}

function stubDeps(
  opts: {
    agent?: unknown | null;
    getAgentThrows?: Error;
    createReturn?: { workflowId: string };
    workflows?: readonly WfStub[];
    dagNodes?: Record<string, readonly { id: string }[]>;
    inFlightNodes?: ReadonlySet<string>;
    nodeTasks?: Record<string, { id: string } | null>;
  } = {},
): {
  catalog: CatalogAgentLookup;
  tasks: TaskService;
  workflows: WorkflowService;
  getAgent: ReturnType<typeof vi.fn>;
  createWorkflow: ReturnType<typeof vi.fn>;
  listWorkflows: ReturnType<typeof vi.fn>;
  getDag: ReturnType<typeof vi.fn>;
  deleteWorkflow: ReturnType<typeof vi.fn>;
  hasInFlightForWorkflowNode: ReturnType<typeof vi.fn>;
  findTaskByWorkflowNode: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
} {
  const getAgent = vi.fn(async (_fqn: string) => {
    if (opts.getAgentThrows !== undefined) throw opts.getAgentThrows;
    return opts.agent === undefined ? COORD_OK : opts.agent;
  });
  const createWorkflow = vi.fn(async () => opts.createReturn ?? { workflowId: "wf-xyz" });
  // Models the substrate's `(origin, origin_id)` SQL filter: the handler
  // delegates schedule-scoping to `list`, so the stub honours `originId`
  // rather than the handler re-filtering client-side.
  const listWorkflows = vi.fn(async (filter?: { originId?: string }) => {
    const all = opts.workflows ?? [];
    return filter?.originId === undefined ? all : all.filter((w) => w.originId === filter.originId);
  });
  const getDag = vi.fn(async (id: string) => ({
    nodes: opts.dagNodes?.[id] ?? [],
  }));
  const deleteWorkflow = vi.fn(async () => undefined);
  const hasInFlightForWorkflowNode = vi.fn(
    async (nodeId: string) => opts.inFlightNodes?.has(nodeId) ?? false,
  );
  const findTaskByWorkflowNode = vi.fn(async (nodeId: string) => {
    if (opts.nodeTasks !== undefined) return opts.nodeTasks[nodeId] ?? null;
    return { id: `task-for-${nodeId}` };
  });
  const deleteTask = vi.fn(async () => undefined);

  const catalog = { getAgent } as unknown as CatalogAgentLookup;
  const tasks = {
    hasInFlightForWorkflowNode,
    findTaskByWorkflowNode,
    delete: deleteTask,
  } as unknown as TaskService;
  const workflows = {
    createWorkflow,
    list: listWorkflows,
    getDag,
    deleteWorkflow,
  } as unknown as WorkflowService;

  return {
    catalog,
    tasks,
    workflows,
    getAgent,
    createWorkflow,
    listWorkflows,
    getDag,
    deleteWorkflow,
    hasInFlightForWorkflowNode,
    findTaskByWorkflowNode,
    deleteTask,
  };
}

function makeHandler(deps: ReturnType<typeof stubDeps>) {
  return makeWorkflowKindHandler({
    workflows: deps.workflows,
    tasks: deps.tasks,
    catalog: deps.catalog,
  });
}

describe("makeWorkflowKindHandler.validate — shape checks", () => {
  it("accepts a minimal valid payload (coordinatorAgent + brief)", async () => {
    const h = makeHandler(stubDeps());
    const result = await h.validate({ coordinatorAgent: "coord", brief: "do x" });
    expect(result).toEqual({ coordinatorAgent: "coord", brief: "do x" });
  });

  it("preserves details when provided", async () => {
    const h = makeHandler(stubDeps());
    const result = await h.validate({
      coordinatorAgent: "coord",
      brief: "do x",
      details: "long body",
    });
    expect(result).toEqual({ coordinatorAgent: "coord", brief: "do x", details: "long body" });
  });

  it("rejects non-object data", async () => {
    const h = makeHandler(stubDeps());
    await expect(h.validate(null)).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
    await expect(h.validate("string")).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
    await expect(h.validate([1, 2])).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
  });

  it("rejects missing / empty coordinatorAgent", async () => {
    const h = makeHandler(stubDeps());
    await expect(h.validate({ brief: "x" })).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
    await expect(h.validate({ coordinatorAgent: "", brief: "x" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
    await expect(h.validate({ coordinatorAgent: "   ", brief: "x" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
  });

  it("rejects missing / empty brief", async () => {
    const h = makeHandler(stubDeps());
    await expect(h.validate({ coordinatorAgent: "coord" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
    await expect(h.validate({ coordinatorAgent: "coord", brief: "" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
  });

  it("rejects multi-line brief", async () => {
    const h = makeHandler(stubDeps());
    await expect(
      h.validate({ coordinatorAgent: "coord", brief: "line1\nline2" }),
    ).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
    await expect(
      h.validate({ coordinatorAgent: "coord", brief: "line1\rline2" }),
    ).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
  });

  it("rejects brief > 200 chars", async () => {
    const h = makeHandler(stubDeps());
    await expect(
      h.validate({ coordinatorAgent: "coord", brief: "x".repeat(201) }),
    ).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
  });

  it("rejects non-string details", async () => {
    const h = makeHandler(stubDeps());
    await expect(
      h.validate({ coordinatorAgent: "coord", brief: "b", details: 123 }),
    ).rejects.toBeInstanceOf(WorkflowScheduleTargetError);
  });
});

describe("makeWorkflowKindHandler.validate — catalog cross-check + coord-eligibility", () => {
  it("calls catalog.getAgent on the full validate path (no changedKeys)", async () => {
    const deps = stubDeps({ agent: COORD_OK });
    const h = makeHandler(deps);
    await h.validate({ coordinatorAgent: "coord", brief: "x" });
    expect(deps.getAgent).toHaveBeenCalledTimes(1);
    expect(deps.getAgent).toHaveBeenCalledWith("coord");
  });

  it("SKIPS catalog.getAgent when changedKeys excludes 'coordinatorAgent'", async () => {
    const deps = stubDeps({ agent: COORD_OK });
    const h = makeHandler(deps);
    await h.validate({ coordinatorAgent: "coord", brief: "new brief" }, { changedKeys: ["brief"] });
    expect(deps.getAgent).not.toHaveBeenCalled();
  });

  it("DOES call catalog.getAgent when changedKeys includes 'coordinatorAgent'", async () => {
    const deps = stubDeps({ agent: COORD_OK });
    const h = makeHandler(deps);
    await h.validate(
      { coordinatorAgent: "coord", brief: "x" },
      { changedKeys: ["coordinatorAgent"] },
    );
    expect(deps.getAgent).toHaveBeenCalledTimes(1);
  });

  it("throws WorkflowScheduleTargetError when the agent is unknown (catalog returns null)", async () => {
    const deps = stubDeps({ agent: null });
    const h = makeHandler(deps);
    await expect(h.validate({ coordinatorAgent: "ghost", brief: "x" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
  });

  it("throws WorkflowScheduleTargetError when the agent is not coord-eligible (empty menu)", async () => {
    const deps = stubDeps({ agent: { name: "leaf", dependencies: { agents: [] } } });
    const h = makeHandler(deps);
    const err = await h.validate({ coordinatorAgent: "leaf", brief: "x" }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(WorkflowScheduleTargetError);
    expect((err as Error).message).toMatch(/coordinator-eligible/);
  });

  it("treats a missing dependencies.agents menu as not coord-eligible", async () => {
    const deps = stubDeps({ agent: { name: "bare" } });
    const h = makeHandler(deps);
    await expect(h.validate({ coordinatorAgent: "bare", brief: "x" })).rejects.toBeInstanceOf(
      WorkflowScheduleTargetError,
    );
  });

  it("throws task-pkg's AgentResolutionFailedError (NOT a 400 target error) when the catalog throws", async () => {
    const deps = stubDeps({ getAgentThrows: new Error("catalog DB down") });
    const h = makeHandler(deps);
    const err = await h.validate({ coordinatorAgent: "coord", brief: "x" }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AgentResolutionFailedError);
    expect(err).not.toBeInstanceOf(WorkflowScheduleTargetError);
    expect((err as AgentResolutionFailedError).agent).toBe("coord");
    // Must NOT echo the raw catalog error string back to the caller.
    expect((err as Error).message).not.toMatch(/catalog DB down/);
  });
});

describe("makeWorkflowKindHandler.mergePatch", () => {
  it("absent patch fields keep existing values; no changedKeys", () => {
    const h = makeHandler(stubDeps());
    const out = h.mergePatch({ coordinatorAgent: "coord", brief: "old" }, {});
    expect(out.data).toEqual({ coordinatorAgent: "coord", brief: "old" });
    expect(out.changedKeys).toEqual([]);
  });

  it("setting coordinatorAgent / brief surfaces them in changedKeys", () => {
    const h = makeHandler(stubDeps());
    const out = h.mergePatch(
      { coordinatorAgent: "old", brief: "old-b" },
      { coordinatorAgent: "new", brief: "new-b" },
    );
    expect(out.data).toEqual({ coordinatorAgent: "new", brief: "new-b" });
    expect([...out.changedKeys].sort()).toEqual(["brief", "coordinatorAgent"]);
  });

  it("null on details deletes the field (RFC 7396)", () => {
    const h = makeHandler(stubDeps());
    const out = h.mergePatch(
      { coordinatorAgent: "coord", brief: "b", details: "old" },
      { details: null },
    );
    expect(out.data).toEqual({ coordinatorAgent: "coord", brief: "b" });
    expect(out.changedKeys).toContain("details");
  });

  it("null on details when already absent does NOT inflate changedKeys", () => {
    const h = makeHandler(stubDeps());
    const out = h.mergePatch({ coordinatorAgent: "coord", brief: "b" }, { details: null });
    expect(out.data).toEqual({ coordinatorAgent: "coord", brief: "b" });
    expect(out.changedKeys).toEqual([]);
  });

  it("string set on details adds the field to changedKeys", () => {
    const h = makeHandler(stubDeps());
    const out = h.mergePatch({ coordinatorAgent: "coord", brief: "b" }, { details: "added" });
    expect(out.data).toEqual({ coordinatorAgent: "coord", brief: "b", details: "added" });
    expect(out.changedKeys).toEqual(["details"]);
  });
});

describe("makeWorkflowKindHandler.dispatch", () => {
  it("calls workflows.createWorkflow with origin/originId + metadata { firedAt } + returns { id }", async () => {
    const deps = stubDeps({ createReturn: { workflowId: "wf-001" } });
    const h = makeHandler(deps);
    const out = await h.dispatch({
      scheduleId: "sched-abc",
      firedAt: "2026-06-01T00:00:00.000Z",
      data: { coordinatorAgent: "coord", brief: "Ship it" },
    });
    expect(out).toEqual({ id: "wf-001" });
    expect(deps.createWorkflow).toHaveBeenCalledTimes(1);
    const call = deps.createWorkflow.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.coordinatorAgent).toBe("coord");
    expect(call.brief).toBe("Ship it");
    expect(call.origin).toBe("schedule");
    expect(call.originId).toBe("sched-abc");
    expect(call.metadata).toEqual({ firedAt: "2026-06-01T00:00:00.000Z" });
  });

  it("conditional-spreads details (omits when not on data)", async () => {
    const deps = stubDeps();
    const h = makeHandler(deps);
    await h.dispatch({
      scheduleId: "s",
      firedAt: "t",
      data: { coordinatorAgent: "coord", brief: "b" },
    });
    const call = deps.createWorkflow.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(call, "details")).toBe(false);
  });

  it("forwards details when present", async () => {
    const deps = stubDeps();
    const h = makeHandler(deps);
    await h.dispatch({
      scheduleId: "s",
      firedAt: "t",
      data: { coordinatorAgent: "coord", brief: "b", details: "long" },
    });
    const call = deps.createWorkflow.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.details).toBe("long");
  });
});

describe("makeWorkflowKindHandler.hasInFlightForSchedule", () => {
  it("returns true only when a running workflow belongs to the schedule", async () => {
    const deps = stubDeps({
      workflows: [
        { id: "w1", status: "succeeded", originId: "sched-abc" },
        { id: "w2", status: "running", originId: "sched-abc" },
      ],
    });
    const h = makeHandler(deps);
    expect(await h.hasInFlightForSchedule("sched-abc")).toBe(true);
  });

  it("ignores running workflows belonging to a different schedule", async () => {
    const deps = stubDeps({
      workflows: [{ id: "w2", status: "running", originId: "other" }],
    });
    const h = makeHandler(deps);
    expect(await h.hasInFlightForSchedule("sched-abc")).toBe(false);
  });

  it("returns false when only terminal workflows belong to the schedule", async () => {
    const deps = stubDeps({
      workflows: [
        { id: "w1", status: "succeeded", originId: "sched-abc" },
        { id: "w3", status: "failed", originId: "sched-abc" },
      ],
    });
    const h = makeHandler(deps);
    expect(await h.hasInFlightForSchedule("sched-abc")).toBe(false);
  });
});

describe("makeWorkflowKindHandler.deleteForSchedule", () => {
  it("cascades each terminal run's node-backing tasks (purge) then purges the workflow dir", async () => {
    const deps = stubDeps({
      workflows: [
        { id: "wf-done", status: "succeeded", originId: "sched-abc" },
        // Running run for the SAME schedule must be left alone.
        { id: "wf-live", status: "running", originId: "sched-abc" },
        // Terminal run for a DIFFERENT schedule must be left alone.
        { id: "wf-other", status: "failed", originId: "other" },
      ],
      dagNodes: { "wf-done": [{ id: "n1" }, { id: "n2" }] },
      nodeTasks: { n1: { id: "task-1" }, n2: { id: "task-2" } },
    });
    const h = makeHandler(deps);

    const out = await h.deleteForSchedule("sched-abc");
    expect(out).toEqual({ deletedCount: 1 });

    // Both node-backing tasks purged.
    expect(deps.deleteTask).toHaveBeenCalledTimes(2);
    expect(deps.deleteTask).toHaveBeenCalledWith("task-1", { purge: true });
    expect(deps.deleteTask).toHaveBeenCalledWith("task-2", { purge: true });

    // Workflow dir purged, and ONLY the terminal same-schedule run is dropped.
    expect(deps.deleteWorkflow).toHaveBeenCalledTimes(1);
    expect(deps.deleteWorkflow).toHaveBeenCalledWith("wf-done", { purgeDir: true });
  });

  it("skips a node with no backing task (no throw)", async () => {
    const deps = stubDeps({
      workflows: [{ id: "wf-done", status: "succeeded", originId: "sched-abc" }],
      dagNodes: { "wf-done": [{ id: "n1" }, { id: "n2" }] },
      nodeTasks: { n1: { id: "task-1" }, n2: null },
    });
    const h = makeHandler(deps);

    const out = await h.deleteForSchedule("sched-abc");
    expect(out).toEqual({ deletedCount: 1 });
    expect(deps.deleteTask).toHaveBeenCalledTimes(1);
    expect(deps.deleteTask).toHaveBeenCalledWith("task-1", { purge: true });
    expect(deps.deleteWorkflow).toHaveBeenCalledWith("wf-done", { purgeDir: true });
  });

  it("skips a terminal run that still has an in-flight node task (no partial delete)", async () => {
    const deps = stubDeps({
      workflows: [{ id: "wf-racy", status: "succeeded", originId: "sched-abc" }],
      dagNodes: { "wf-racy": [{ id: "n1" }, { id: "n2" }] },
      inFlightNodes: new Set(["n2"]),
    });
    const h = makeHandler(deps);

    const out = await h.deleteForSchedule("sched-abc");
    // Nothing deleted — the run is left for a later sweep.
    expect(out).toEqual({ deletedCount: 0 });
    expect(deps.deleteTask).not.toHaveBeenCalled();
    expect(deps.deleteWorkflow).not.toHaveBeenCalled();
  });

  it("returns deletedCount 0 when no terminal runs belong to the schedule", async () => {
    const deps = stubDeps({
      workflows: [{ id: "wf-live", status: "running", originId: "sched-abc" }],
    });
    const h = makeHandler(deps);
    const out = await h.deleteForSchedule("sched-abc");
    expect(out).toEqual({ deletedCount: 0 });
    expect(deps.deleteWorkflow).not.toHaveBeenCalled();
  });
});
