/**
 * Unit tests for `makeTaskKindHandler`. This is the sole module
 * that knows about all three of `@glyphs-ai/schedule`,
 * `@glyphs-ai/task`, and `@glyphs-ai/catalog` — see
 * `../../src/wiring/schedule-task-handler.ts`. Covers:
 *
 *   - `validate(data)` shape checks (agent / brief / details / runtime)
 *   - `validate(data, { changedKeys })` SKIPs catalog lookup when
 *     `agent` is not in `changedKeys` (the patch-when-catalog-down
 *     property the service preserves)
 *   - `validate` wraps null catalog hits as task `AgentNotFound`
 *     unions, and catalog throws as `AgentUnresolvable` unions
 *   - `mergePatch` RFC 7396 semantics + `changedKeys` accuracy
 *   - `dispatch` synthesises `origin: "schedule"` +
 *     `originId: scheduleId` + `metadata: { firedAt }`, conditional-spreads
 *     `details` / `runtime`, returns `{ id }`
 *   - `hasInFlightForSchedule` / `deleteForSchedule` delegation
 */

import type { TaskModule } from "@glyphs-ai/task";
import { okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { makeTaskKindHandler } from "../../src/wiring/schedule-task-handler.js";

type CatalogAgentLookup = Parameters<typeof makeTaskKindHandler>[0]["catalog"];

async function expectOk<T, E>(resultLike: ResultAsync<T, E>): Promise<T> {
  const result = await resultLike;
  expect(result.isOk()).toBe(true);
  return result._unsafeUnwrap();
}

async function expectErr<T, E>(resultLike: ResultAsync<T, E>): Promise<E> {
  const result = await resultLike;
  expect(result.isErr()).toBe(true);
  return result._unsafeUnwrapErr();
}

async function expectTaskTargetInvalid(
  resultLike: ResultAsync<unknown, { readonly cause: unknown }>,
  message: string,
): Promise<void> {
  const fault = await expectErr(resultLike);
  expect(fault.cause).toEqual({ type: "TaskTargetInvalid", message });
}

function stubDeps(
  opts: { agent?: unknown | null; getAgentThrows?: Error; dispatchReturn?: { id: string } } = {},
): {
  catalog: CatalogAgentLookup;
  tasks: TaskModule;
  getAgent: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  hasInFlightByOrigin: ReturnType<typeof vi.fn>;
  deleteTerminalByOrigin: ReturnType<typeof vi.fn>;
} {
  const getAgent = vi.fn(async (_fqn: string) => {
    if (opts.getAgentThrows !== undefined) throw opts.getAgentThrows;
    return opts.agent === undefined ? { name: "default-agent" } : opts.agent;
  });
  const dispatch = vi.fn(() => okAsync(opts.dispatchReturn ?? { id: "task-xyz" }));
  const hasInFlightByOrigin = vi.fn(() => okAsync(false));
  const deleteTerminalByOrigin = vi.fn(() => okAsync({ deletedCount: 0 }));
  const catalog = { getAgent } as unknown as CatalogAgentLookup;
  const tasks = {
    dispatchTask: { execute: dispatch },
    hasInFlightByOrigin: { execute: hasInFlightByOrigin },
    deleteTerminalByOrigin: { execute: deleteTerminalByOrigin },
  } as unknown as TaskModule;
  return {
    catalog,
    tasks,
    getAgent,
    dispatch,
    hasInFlightByOrigin,
    deleteTerminalByOrigin,
  };
}

describe("makeTaskKindHandler.validate — shape checks", () => {
  it("accepts a minimal valid payload (agent + brief)", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const result = await expectOk(h.validate({ agent: "writer", brief: "do x" }));
    expect(result).toEqual({ agent: "writer", brief: "do x" });
  });

  it("preserves details + runtime when provided", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const result = await expectOk(
      h.validate({
        agent: "writer",
        brief: "do x",
        details: "long body",
        runtime: "copilot",
      }),
    );
    expect(result).toEqual({
      agent: "writer",
      brief: "do x",
      details: "long body",
      runtime: "copilot",
    });
  });

  it("rejects non-object data", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(h.validate(null), "Task target data must be an object");
    await expectTaskTargetInvalid(h.validate("string"), "Task target data must be an object");
    await expectTaskTargetInvalid(h.validate([1, 2]), "Task target data must be an object");
  });

  it("rejects missing / empty agent", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ brief: "x" }),
      "Task target requires non-empty agent",
    );
    await expectTaskTargetInvalid(
      h.validate({ agent: "", brief: "x" }),
      "Task target requires non-empty agent",
    );
    await expectTaskTargetInvalid(
      h.validate({ agent: "   ", brief: "x" }),
      "Task target requires non-empty agent",
    );
  });

  it("rejects missing / empty brief", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ agent: "a" }),
      "Task target Invalid input: expected string, received undefined",
    );
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "" }),
      "Task target brief must be non-empty after trim",
    );
  });

  it("rejects multi-line brief", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "line1\nline2" }),
      "Task target brief must be a single line (no newline characters); pass long content via details",
    );
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "line1\rline2" }),
      "Task target brief must be a single line (no newline characters); pass long content via details",
    );
  });

  it("rejects brief > 200 chars", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "x".repeat(201) }),
      "Task target brief must be 200 characters or fewer",
    );
  });

  it("rejects non-string details", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "b", details: 123 }),
      "Task target details, when set, must be a string",
    );
  });

  it("rejects empty runtime", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectTaskTargetInvalid(
      h.validate({ agent: "a", brief: "b", runtime: "" }),
      "Task target runtime, when set, must be a non-empty string",
    );
  });
});

describe("makeTaskKindHandler.validate — catalog cross-check", () => {
  it("calls catalog.getAgent on the full validate path (no changedKeys)", async () => {
    const deps = stubDeps({ agent: { name: "writer" } });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectOk(h.validate({ agent: "writer", brief: "x" }));
    expect(deps.getAgent).toHaveBeenCalledTimes(1);
    expect(deps.getAgent).toHaveBeenCalledWith("writer");
  });

  it("SKIPS catalog.getAgent when changedKeys excludes 'agent' (e.g. brief-only patch)", async () => {
    const deps = stubDeps({ agent: { name: "writer" } });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectOk(h.validate({ agent: "writer", brief: "new brief" }, { changedKeys: ["brief"] }));
    // No catalog round-trip — preserves the patch-when-catalog-down
    // property the service exposes.
    expect(deps.getAgent).not.toHaveBeenCalled();
  });

  it("DOES call catalog.getAgent when changedKeys includes 'agent'", async () => {
    const deps = stubDeps({ agent: { name: "writer" } });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectOk(h.validate({ agent: "writer", brief: "x" }, { changedKeys: ["agent"] }));
    expect(deps.getAgent).toHaveBeenCalledTimes(1);
  });

  it("returns task-pkg's AgentNotFound DU when catalog returns null", async () => {
    const deps = stubDeps({ agent: null });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const fault = await expectErr(h.validate({ agent: "ghost", brief: "x" }));
    expect(fault.cause).toEqual({ type: "AgentNotFound", agent: "ghost" });
  });

  it("returns task-pkg's AgentUnresolvable DU on any other catalog throw", async () => {
    const deps = stubDeps({ getAgentThrows: new Error("DB exploded") });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const fault = await expectErr(h.validate({ agent: "writer", brief: "x" }));
    expect(fault.cause).toMatchObject({ type: "AgentUnresolvable", agent: "writer" });
  });
});

describe("makeTaskKindHandler.mergePatch", () => {
  it("absent patch fields keep existing values; no changedKeys", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = h.mergePatch({ agent: "writer", brief: "old" }, {});
    expect(out.data).toEqual({ agent: "writer", brief: "old" });
    expect(out.changedKeys).toEqual([]);
  });

  it("setting agent / brief surfaces them in changedKeys", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = h.mergePatch({ agent: "old", brief: "old-b" }, { agent: "new", brief: "new-b" });
    expect(out.data).toEqual({ agent: "new", brief: "new-b" });
    expect([...out.changedKeys].sort()).toEqual(["agent", "brief"]);
  });

  it("null on details deletes the field (RFC 7396)", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = h.mergePatch(
      { agent: "a", brief: "b", details: "old", runtime: "node-22" },
      { details: null },
    );
    expect(out.data).toEqual({ agent: "a", brief: "b", runtime: "node-22" });
    expect(out.changedKeys).toContain("details");
  });

  it("null on details when already absent does NOT inflate changedKeys", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = h.mergePatch({ agent: "a", brief: "b" }, { details: null });
    expect(out.data).toEqual({ agent: "a", brief: "b" });
    expect(out.changedKeys).toEqual([]);
  });

  it("string set on details adds the field to changedKeys", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = h.mergePatch({ agent: "a", brief: "b" }, { details: "added" });
    expect(out.data).toEqual({ agent: "a", brief: "b", details: "added" });
    expect(out.changedKeys).toEqual(["details"]);
  });

  it("null on runtime deletes; string set adds (mirrors details)", () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out1 = h.mergePatch({ agent: "a", brief: "b", runtime: "node-22" }, { runtime: null });
    expect(out1.data).toEqual({ agent: "a", brief: "b" });
    expect(out1.changedKeys).toEqual(["runtime"]);

    const out2 = h.mergePatch({ agent: "a", brief: "b" }, { runtime: "copilot" });
    expect(out2.data).toEqual({ agent: "a", brief: "b", runtime: "copilot" });
    expect(out2.changedKeys).toEqual(["runtime"]);
  });
});

describe("makeTaskKindHandler.dispatch", () => {
  it("synthesises origin: 'schedule' + metadata + returns { id }", async () => {
    const deps = stubDeps({ dispatchReturn: { id: "task-001" } });
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    const out = await expectOk(
      h.dispatch({
        scheduleId: "sched-abc",
        firedAt: "2026-06-01T00:00:00.000Z",
        data: { agent: "writer", brief: "Summarize" },
      }),
    );
    expect(out).toEqual({ id: "task-001" });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    const call = deps.dispatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.agent).toBe("writer");
    expect(call.brief).toBe("Summarize");
    expect(call.origin).toBe("schedule");
    expect(call.originId).toBe("sched-abc");
    expect(call.metadata).toEqual({ firedAt: "2026-06-01T00:00:00.000Z" });
  });

  it("conditional-spreads details + runtime (omits when not on data)", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectOk(
      h.dispatch({
        scheduleId: "s",
        firedAt: "t",
        data: { agent: "a", brief: "b" },
      }),
    );
    const call = deps.dispatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(call, "details")).toBe(false);
    expect(Object.hasOwn(call, "runtime")).toBe(false);
  });

  it("forwards details + runtime when present", async () => {
    const deps = stubDeps();
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    await expectOk(
      h.dispatch({
        scheduleId: "s",
        firedAt: "t",
        data: { agent: "a", brief: "b", details: "long", runtime: "node" },
      }),
    );
    const call = deps.dispatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.details).toBe("long");
    expect(call.runtime).toBe("node");
  });
});

describe("makeTaskKindHandler.hasInFlightForSchedule + deleteForSchedule", () => {
  it("hasInFlightForSchedule delegates to hasInFlightByOrigin", async () => {
    const deps = stubDeps();
    deps.hasInFlightByOrigin.mockReturnValueOnce(okAsync(true));
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    expect(await expectOk(h.hasInFlightForSchedule("sched-abc"))).toBe(true);
    expect(deps.hasInFlightByOrigin).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "sched-abc",
    });
  });

  it("deleteForSchedule delegates to deleteTerminalByOrigin", async () => {
    const deps = stubDeps();
    deps.deleteTerminalByOrigin.mockReturnValueOnce(okAsync({ deletedCount: 17 }));
    const h = makeTaskKindHandler({ catalog: deps.catalog, tasks: deps.tasks });
    expect(await expectOk(h.deleteForSchedule("sched-abc"))).toEqual({ deletedCount: 17 });
    expect(deps.deleteTerminalByOrigin).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "sched-abc",
    });
  });
});
