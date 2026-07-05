/**
 * Tests for `makeWorkerNodeRunner`. Mirrors the structure of
 * `schedule-task-handler.test.ts` — uses mocked `TaskModule` +
 * `CatalogAgentLookup` to exercise the runner in isolation, focusing on
 * the kind-specific concerns the runner owns:
 *
 *   - validate: shape checks + agent-existence lookup
 *     (`AgentNotFound` / `AgentResolutionFailed` task unions)
 *   - dispatch: synthesises `origin: 'workflow'` + the node id in the
 *     typed `origin_id` column (reverse-lookup); installs the
 *     per-node poll interval and returns `void` (the runner logs the
 *     task id at info inside dispatch for audit / log correlation)
 *   - poll loop status→terminal mapping (`succeeded` / `failed` /
 *     `cancelled` / `null` task), runner-local error budget exhaustion
 *   - hasInFlightForNode delegation to
 *     `tasks.hasInFlightByOrigin.execute`
 *   - cancel reverse-lookup + per-task `tasks.cancelTask.execute(...)`,
 *     idempotency on duplicate cancel
 *   - dispose clears every armed interval (no `setInterval` leaks)
 *
 * A variant using a REAL `TaskModule` + no-op runtime is possible.
 * Two reasons we use mocks here instead:
 *   1. The schedule-task-handler tests next to this one use mocks
 *      — staying consistent with that precedent keeps the api-pkg
 *      test surface uniform.
 *   2. The runner's responsibilities are entirely about the
 *      task module interface; standing up a real TaskModule would
 *      verify TaskModule's behavior, not the runner's.
 * The engine-integration test (`packages/workflow/test/engine-integration.test.ts`)
 * already exercises the engine ↔ runner pipeline end-to-end with a
 * fake runner; together the two tiers cover every invariant the
 * runner is responsible for without the cost of a real TaskModule
 * boot in this layer.
 */

import type { TaskModule } from "@glyphs-ai/task";
import type { ResultAsync } from "neverthrow";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKER_MAX_POLL_ERRORS,
  DEFAULT_WORKER_POLL_INTERVAL_MS,
  makeWorkerNodeRunner,
  WorkflowWorkerNotInCoordMenuError,
  WorkflowWorkerSpecError,
} from "../../src/wiring/workflow-worker-task-runner.js";

type CatalogAgentLookup = Parameters<typeof makeWorkerNodeRunner>[0]["catalog"];

async function errCause<T>(
  resultAsync: ResultAsync<T, { readonly cause: unknown }>,
): Promise<unknown> {
  const result = await resultAsync;
  expect(result.isErr()).toBe(true);
  return result._unsafeUnwrapErr().cause;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal Task stub for status-mapping tests; full Task type not needed.
function fakeTaskRow(overrides: Partial<{ id: string; status: string }> = {}): any {
  // Returns a minimal Task-shaped object suitable for the runner's
  // status-mapping logic. We don't import the full Task type because
  // the runner only reads `id`, `status`, `success`, `failure`,
  // `cancellation` — and reflectively only when present.
  return {
    id: overrides.id ?? "task-id-1",
    status: overrides.status ?? "running",
    metadata: {},
    agent: "w",
    brief: "b",
    origin: "workflow",
    createdAt: "2026-06-07T00:00:00.000Z",
    startedAt: "2026-06-07T00:00:00.000Z",
  };
}

function stubDeps(
  opts: {
    agent?: unknown | null;
    getAgentThrows?: Error;
    /**
     * Override the coord agent returned by the menu-membership catalog
     * lookup when `getAgent(ctx.coordinatorAgent)` fires. Default:
     * a coord-shaped agent whose `dependencies.agents` includes the
     * default worker FQN `"w"` used by `NODE_VALIDATE_CTX` /
     * `DISPATCH_OPTS_BASE`, so
     * the default `{agent: "w", brief: "b"}` spec passes the
     * menu-membership check without per-test plumbing. Pass `null` to
     * simulate "coord uninstalled mid-workflow".
     */
    coordAgent?: unknown | null;
    dispatchReturn?: { id: string };
    // biome-ignore lint/suspicious/noExplicitAny: stub return shape mirrors fakeTaskRow.
    getReturn?: any;
    getThrows?: Error;
    // biome-ignore lint/suspicious/noExplicitAny: stub return shape mirrors fakeTaskRow.
    listInFlightReturn?: any[];
    listInFlightThrows?: Error;
    hasInFlightReturn?: boolean;
  } = {},
) {
  const getAgent = vi.fn(async (fqn: string) => {
    if (opts.getAgentThrows !== undefined) throw opts.getAgentThrows;
    // Worker validation does two catalog lookups: one for the
    // worker's spec.agent, and a second for `ctx.coordinatorAgent`
    // (menu-membership check). The stub discriminates so an
    // `opts.agent` override targets the worker resolution only,
    // while the coord resolution stays valid by default; the
    // menu-membership tests below pass an explicit `coordAgent` to
    // drive the membership branches.
    if (fqn === NODE_VALIDATE_CTX.coordinatorAgent) {
      return "coordAgent" in opts
        ? opts.coordAgent
        : { fqn: "coord", dependencies: { agents: [{ fqn: "w" }] } };
    }
    return opts.agent === undefined ? { name: "default-agent" } : opts.agent;
  });
  const dispatch = vi.fn(() => okAsync(opts.dispatchReturn ?? fakeTaskRow({ id: "task-id-1" })));
  const get = vi.fn((_req: { id: string }) => {
    if (opts.getThrows !== undefined) {
      return errAsync({ type: "DatabaseUnavailable" as const, cause: opts.getThrows });
    }
    return okAsync(opts.getReturn !== undefined ? opts.getReturn : fakeTaskRow());
  });
  const hasInFlightForWorkflowNode = vi.fn(() => okAsync(opts.hasInFlightReturn ?? false));
  const listInFlightForWorkflowNode = vi.fn(() => {
    if (opts.listInFlightThrows !== undefined) {
      return errAsync({ type: "DatabaseUnavailable" as const, cause: opts.listInFlightThrows });
    }
    return okAsync(opts.listInFlightReturn ?? []);
  });
  const cancel = vi.fn((_req: { id: string }) => okAsync(fakeTaskRow()));
  const catalog = { getAgent } as unknown as CatalogAgentLookup;
  const tasks = {
    dispatchTask: { execute: dispatch },
    getTask: { execute: get },
    hasInFlightByOrigin: { execute: hasInFlightForWorkflowNode },
    listInFlightByOrigin: { execute: listInFlightForWorkflowNode },
    cancelTask: { execute: cancel },
  } as unknown as TaskModule;
  return {
    catalog,
    tasks,
    getAgent,
    dispatch,
    get,
    hasInFlightForWorkflowNode,
    listInFlightForWorkflowNode,
    cancel,
  };
}

const NODE_VALIDATE_CTX = {
  workflowId: "20260101-deadbeef",
  workflowStatus: "running" as const,
  // Coord FQN threaded from the workflow row (denormalized
  // `workflows.coordinator_agent`). Worker runner uses it for
  // menu-membership checks; the tests below construct catalog
  // stubs whose `coord` agent declares `dependencies.agents = [w]`
  // so the default {agent: "w"} spec is in-menu.
  coordinatorAgent: "coord",
};

const DISPATCH_OPTS_BASE = {
  workflowId: "20260101-deadbeef",
  nodeId: "deadbeef-cafe-4bab-89ab-cafebabe1234",
  spec: { agent: "w", brief: "b" } as unknown,
};

describe("makeWorkerNodeRunner — validate", () => {
  it("accepts a minimal valid spec", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    const result = (
      await r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX)
    )._unsafeUnwrap();
    expect(result).toEqual({ agent: "w", brief: "b" });
    expect(deps.getAgent).toHaveBeenCalledWith("w");
    await r.dispose();
  });

  it("preserves details + runtime when provided", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    const result = (
      await r.validate(
        { agent: "w", brief: "b", details: "long body", runtime: "copilot" },
        NODE_VALIDATE_CTX,
      )
    )._unsafeUnwrap();
    expect(result).toEqual({
      agent: "w",
      brief: "b",
      details: "long body",
      runtime: "copilot",
    });
    await r.dispose();
  });

  it("rejects non-object spec", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(await errCause(r.validate(null, NODE_VALIDATE_CTX))).toBeInstanceOf(
      WorkflowWorkerSpecError,
    );
    expect(await errCause(r.validate("string", NODE_VALIDATE_CTX))).toBeInstanceOf(
      WorkflowWorkerSpecError,
    );
    expect(await errCause(r.validate([], NODE_VALIDATE_CTX))).toBeInstanceOf(
      WorkflowWorkerSpecError,
    );
    await r.dispose();
  });

  it("rejects missing / non-string agent", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(await errCause(r.validate({ brief: "b" }, NODE_VALIDATE_CTX))).toBeInstanceOf(
      WorkflowWorkerSpecError,
    );
    expect(
      await errCause(r.validate({ agent: "  ", brief: "b" }, NODE_VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowWorkerSpecError);
    await r.dispose();
  });

  it("rejects multi-line brief", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(
      await errCause(r.validate({ agent: "w", brief: "line1\nline2" }, NODE_VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowWorkerSpecError);
    await r.dispose();
  });

  it("throws AgentNotFound DU when catalog returns null", async () => {
    const deps = stubDeps({ agent: null });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(
      await errCause(r.validate({ agent: "missing", brief: "b" }, NODE_VALIDATE_CTX)),
    ).toMatchObject({ type: "AgentNotFound", agent: "missing" });
    await r.dispose();
  });

  it("throws AgentResolutionFailed DU when catalog throws", async () => {
    const deps = stubDeps({ getAgentThrows: new Error("catalog down") });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(await errCause(r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX))).toMatchObject(
      {
        type: "AgentResolutionFailed",
        agent: "w",
      },
    );
    await r.dispose();
  });

  // ── Workflow worker menu-membership discipline ─────────────────────────
  //
  // The worker runner's menu-membership check fires AFTER worker agent
  // existence but BEFORE the validate returns. It requires the
  // spec.agent FQN to appear in the coord agent's `dependencies.agents`
  // dispatch menu.
  // The coord agent is looked up via `ctx.coordinatorAgent` (threaded
  // by the substrate from the denormalized workflow header).

  it("accepts a worker whose FQN is in the coord's dispatch menu", async () => {
    const deps = stubDeps({
      coordAgent: {
        fqn: "coord",
        dependencies: { agents: [{ fqn: "w" }, { fqn: "other" }] },
      },
    });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    const result = (
      await r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX)
    )._unsafeUnwrap();
    expect(result).toEqual({ agent: "w", brief: "b" });
    // The menu check must query the coord agent in addition to the worker.
    expect(deps.getAgent).toHaveBeenCalledWith("w");
    expect(deps.getAgent).toHaveBeenCalledWith(NODE_VALIDATE_CTX.coordinatorAgent);
    await r.dispose();
  });

  it("rejects a worker whose FQN is NOT in the coord's dispatch menu", async () => {
    const deps = stubDeps({
      coordAgent: {
        fqn: "coord",
        dependencies: { agents: [{ fqn: "dev" }, { fqn: "review" }] },
      },
    });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(
      await errCause(r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowWorkerNotInCoordMenuError);
    expect(
      await errCause(r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX)),
    ).toHaveProperty(
      "message",
      expect.stringMatching(/dispatch menu|dependencies\.agents|not in/i),
    );
    await r.dispose();
  });

  it("rejects when the coord agent has no `dependencies.agents` block at all", async () => {
    const deps = stubDeps({
      // Bare coord — no dependencies field. Worker can never satisfy
      // an empty menu, regardless of FQN.
      coordAgent: { fqn: "coord" },
    });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    expect(
      await errCause(r.validate({ agent: "w", brief: "b" }, NODE_VALIDATE_CTX)),
    ).toBeInstanceOf(WorkflowWorkerNotInCoordMenuError);
    await r.dispose();
  });
});

describe("makeWorkerNodeRunner — dispatch", () => {
  it("calls tasks.dispatchTask.execute with origin='workflow' + originId + metadata + 2-key subprocessEnv", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: fakeTaskRow is intentionally minimal vs the full Task type.
    const deps = stubDeps({ dispatchReturn: fakeTaskRow({ id: "tid-7" }) as any });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100_000, // never poll during this test
    });
    const result = (
      await r.dispatch({
        ...DISPATCH_OPTS_BASE,
        onTerminal: () => {},
      })
    )._unsafeUnwrap();
    expect(deps.dispatch).toHaveBeenCalledWith({
      agent: "w",
      brief: "b",
      origin: "workflow",
      originId: "deadbeef-cafe-4bab-89ab-cafebabe1234",
      metadata: {
        workflowId: "20260101-deadbeef",
      },
      // Worker tasks see the two workflow identity env keys
      // (`GLYPH_WORKFLOW_ID`, `GLYPH_NODE_ID`) but NOT
      // `GLYPH_WORKFLOW_DIR` — the per-workflow shared dir is
      // coord-only by design. Worker also does NOT pass `prompt`
      // (uses `@glyphs-ai/task`'s default framing).
      subprocessEnv: {
        GLYPH_WORKFLOW_ID: "20260101-deadbeef",
        GLYPH_NODE_ID: "deadbeef-cafe-4bab-89ab-cafebabe1234",
      },
    });
    expect(result).toBeUndefined();
    await r.dispose();
  });

  it("does NOT pass GLYPH_WORKFLOW_DIR (coord-only) or a prompt override", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100_000,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal: () => {} });

    const calls = deps.dispatch.mock.calls as unknown as ReadonlyArray<
      readonly [Record<string, unknown>]
    >;
    const firstCall = calls[0]?.[0];
    expect(firstCall).toBeDefined();
    if (firstCall !== undefined) {
      // No prompt override — worker dispatch must NOT include the
      // key; the task pkg's default `DEFAULT_TASK_FRAMING_PROMPT`
      // applies. (Conditional-spread style would otherwise
      // serialize `prompt: undefined`.)
      expect(Object.keys(firstCall)).not.toContain("prompt");
      // No coord-only env key.
      const env = (firstCall as { subprocessEnv?: Record<string, string> }).subprocessEnv;
      expect(env).toBeDefined();
      expect(env).not.toHaveProperty("GLYPH_WORKFLOW_DIR");
    }
    await r.dispose();
  });

  it("forwards details + runtime when present on the spec", async () => {
    const deps = stubDeps();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100_000,
    });
    await r.dispatch({
      ...DISPATCH_OPTS_BASE,
      spec: { agent: "w", brief: "b", details: "d", runtime: "copilot" },
      onTerminal: () => {},
    });
    expect(deps.dispatch).toHaveBeenCalledWith({
      agent: "w",
      brief: "b",
      details: "d",
      runtime: "copilot",
      origin: "workflow",
      originId: "deadbeef-cafe-4bab-89ab-cafebabe1234",
      metadata: {
        workflowId: "20260101-deadbeef",
      },
      // The injected env shape is the same two identity keys
      // regardless of spec.details / spec.runtime — those spec
      // fields don't influence the env bag.
      subprocessEnv: {
        GLYPH_WORKFLOW_ID: "20260101-deadbeef",
        GLYPH_NODE_ID: "deadbeef-cafe-4bab-89ab-cafebabe1234",
      },
    });
    await r.dispose();
  });
});

describe("makeWorkerNodeRunner — poll loop terminal mapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps task.status='succeeded' → onTerminal({status:'succeeded'})", async () => {
    const deps = stubDeps({
      getReturn: fakeTaskRow({ status: "succeeded" }),
    });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    // Settle the microtask the interval callback queued.
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    const arg = onTerminal.mock.calls[0]?.[0];
    expect(arg.status).toBe("succeeded");
    await r.dispose();
  });

  it("maps task.status='failed' → onTerminal({status:'failed', reason})", async () => {
    const failure = { kind: "exited", exit_code: 1, message: "non-zero exit" };
    const deps = stubDeps({
      getReturn: { ...fakeTaskRow({ status: "failed" }), failure },
    });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    const arg = onTerminal.mock.calls[0]?.[0];
    expect(arg.status).toBe("failed");
    expect(arg.reason).toBe("non-zero exit");
    await r.dispose();
  });

  it("maps task.status='cancelled' → onTerminal({status:'cancelled', reason})", async () => {
    const cancellation = { kind: "user", message: "cancelled by user" };
    const deps = stubDeps({
      getReturn: { ...fakeTaskRow({ status: "cancelled" }), cancellation },
    });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal.mock.calls[0]?.[0]).toEqual({
      status: "cancelled",
      reason: "cancelled by user",
    });
    await r.dispose();
  });

  it("falls back to a runner-default reason when cancellation.message is absent", async () => {
    const deps = stubDeps({
      getReturn: fakeTaskRow({ status: "cancelled" }),
    });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal.mock.calls[0]?.[0]).toEqual({
      status: "cancelled",
      reason: "task cancelled (no reason recorded)",
    });
    await r.dispose();
  });

  it("maps tasks.getTask.execute → null → onTerminal({status:'failed', reason:'task not found'})", async () => {
    const deps = stubDeps({ getReturn: null });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    const arg = onTerminal.mock.calls[0]?.[0];
    expect(arg.status).toBe("failed");
    expect(arg.reason).toBe("task not found");
    await r.dispose();
  });

  it("running status does NOT fire onTerminal (poll continues)", async () => {
    const deps = stubDeps({ getReturn: fakeTaskRow({ status: "running" }) });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).not.toHaveBeenCalled();
    expect(deps.get.mock.calls.length).toBeGreaterThanOrEqual(2);
    await r.dispose();
  });

  it("clears poll interval after firing onTerminal (no further polls)", async () => {
    const deps = stubDeps({
      getReturn: fakeTaskRow({ status: "succeeded" }),
    });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterFirst = deps.get.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.get.mock.calls.length).toBe(callsAfterFirst);
    await r.dispose();
  });
});

describe("makeWorkerNodeRunner — poll error budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exhausts the error budget after maxPollErrors consecutive throws", async () => {
    const deps = stubDeps({ getThrows: new Error("transient boom") });
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
      maxPollErrors: 3,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    // Tick past three poll cycles.
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    const arg = onTerminal.mock.calls[0]?.[0];
    expect(arg.status).toBe("failed");
    expect(String(arg.reason)).toMatch(/tasks\.get exhausted/);
    expect(String(arg.reason)).toMatch(/transient boom/);
    await r.dispose();
  });

  it("resets error counter on a successful poll between errors", async () => {
    // Error → success → error → success — never reaches maxPollErrors.
    let n = 0;
    const get = vi.fn((_req: { id: string }) => {
      n += 1;
      if (n % 2 === 1) {
        return errAsync({ type: "DatabaseUnavailable" as const, cause: new Error("flaky") });
      }
      return okAsync(fakeTaskRow({ status: "running" }));
    });
    const deps = stubDeps();
    (deps.tasks.getTask as unknown as { execute: typeof get }).execute = get;
    const onTerminal = vi.fn();
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
      pollIntervalMs: 100,
      maxPollErrors: 2,
    });
    await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).not.toHaveBeenCalled();
    await r.dispose();
  });
});

describe("makeWorkerNodeRunner — hasInFlightForNode + cancel + dispose", () => {
  it("hasInFlightForNode delegates to tasks.hasInFlightByOrigin.execute", async () => {
    const deps = stubDeps({ hasInFlightReturn: true });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    const result = (
      await r.hasInFlightForNode("deadbeef-cafe-4bab-89ab-cafebabe1234")
    )._unsafeUnwrap();
    expect(result).toBe(true);
    expect(deps.hasInFlightForWorkflowNode).toHaveBeenCalledWith({
      origin: "workflow",
      originId: "deadbeef-cafe-4bab-89ab-cafebabe1234",
    });
    await r.dispose();
  });

  it("cancel reverse-looks-up via tasks.listInFlightByOrigin.execute and calls tasks.cancelTask.execute for each", async () => {
    const deps = stubDeps({
      listInFlightReturn: [fakeTaskRow({ id: "t-a" }), fakeTaskRow({ id: "t-b" })],
    });
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    await r.cancel("deadbeef-cafe-4bab-89ab-cafebabe1234");
    expect(deps.listInFlightForWorkflowNode).toHaveBeenCalledWith({
      origin: "workflow",
      originId: "deadbeef-cafe-4bab-89ab-cafebabe1234",
    });
    expect(deps.cancel).toHaveBeenCalledTimes(2);
    expect(deps.cancel).toHaveBeenCalledWith({ id: "t-a" });
    expect(deps.cancel).toHaveBeenCalledWith({ id: "t-b" });
    await r.dispose();
  });

  it("cancel survives tasks.cancelTask.execute throwing on one task (best-effort, continues)", async () => {
    const deps = stubDeps({
      listInFlightReturn: [fakeTaskRow({ id: "t-a" }), fakeTaskRow({ id: "t-b" })],
    });
    const cancel = vi.fn((req: { id: string }) => {
      if (req.id === "t-a") {
        return errAsync({ type: "DatabaseUnavailable" as const, cause: new Error("cancel boom") });
      }
      return okAsync(fakeTaskRow({ id: req.id }));
    });
    (deps.tasks.cancelTask as unknown as { execute: typeof cancel }).execute = cancel;
    const r = makeWorkerNodeRunner({
      catalog: deps.catalog,
      tasks: deps.tasks,
    });
    // Should NOT throw; the runner logs and continues.
    await r.cancel("deadbeef-cafe-4bab-89ab-cafebabe1234");
    expect(cancel).toHaveBeenCalledTimes(2);
    await r.dispose();
  });

  it("dispose() clears every armed interval", async () => {
    vi.useFakeTimers();
    try {
      const deps = stubDeps({ getReturn: fakeTaskRow({ status: "running" }) });
      const r = makeWorkerNodeRunner({
        catalog: deps.catalog,
        tasks: deps.tasks,
        pollIntervalMs: 100,
      });
      const onTerminal = vi.fn();
      await r.dispatch({ ...DISPATCH_OPTS_BASE, onTerminal });
      await r.dispatch({
        ...DISPATCH_OPTS_BASE,
        nodeId: "cafebabe-dead-4bee-89ab-feedbabe1234",
        onTerminal,
      });
      await vi.advanceTimersByTimeAsync(150);
      const callsBeforeDispose = deps.get.mock.calls.length;
      expect(callsBeforeDispose).toBeGreaterThanOrEqual(2);
      await r.dispose();
      // After dispose no further polls should fire.
      await vi.advanceTimersByTimeAsync(500);
      expect(deps.get.mock.calls.length).toBe(callsBeforeDispose);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("makeWorkerNodeRunner — exported constants + factory shape", () => {
  it("exposes default poll interval + max poll errors constants", () => {
    expect(DEFAULT_WORKER_POLL_INTERVAL_MS).toBe(2000);
    expect(DEFAULT_WORKER_MAX_POLL_ERRORS).toBe(3);
  });

  it("WorkflowWorkerSpecError sets the canonical .name for instanceof routing", async () => {
    const err = new WorkflowWorkerSpecError("bad spec");
    expect(err.name).toBe("WorkflowWorkerSpecError");
    expect(err.message).toBe("bad spec");
  });
});
