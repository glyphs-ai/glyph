/**
 * Pinned race-semantics tests for the internal
 * `WorkspaceContextRegistry`. The class is exported from
 * `workspace-context.ts` but NOT re-exported on the package barrel;
 * this file imports it via the relative path so the pkg-internal
 * contract stays testable without widening the public surface.
 *
 * Two scenarios:
 *
 *   1. `closeAll()` drains an inflight `get()` before disposing.
 *      Without the drain a concurrent load resolves after closeAll
 *      clears the map, leaving the freshly-built context in the
 *      `entries` map past process exit.
 *
 *   2. `load()`'s cleanup stack runs in reverse on a thrown
 *      `composeScheduleModule`. The previously-built catalog /
 *      session / task modules must each have `close()` called in
 *      reverse-of-compose order so SQLite handles + WAL pins don't
 *      leak on the failure path.
 *
 * Both tests mock the per-BC `compose*Module` functions and
 * `node:fs/promises.mkdir` so the registry exercises its lifecycle
 * paths without touching disk or any real BC code.
 */
import type { CatalogModule } from "@glyphs-ai/catalog";
import { InMemoryRuntimeRegistry } from "@glyphs-ai/runtime";
import type { ScheduleModule } from "@glyphs-ai/schedule";
import type { TaskModule } from "@glyphs-ai/task";
import type { WorkflowModule } from "@glyphs-ai/workflow";
import type { GetWorkspaceResponse, WorkspaceModule } from "@glyphs-ai/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}

function makeGate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  // Reassigned per-test; default is "resolve immediately".
  catalogGate: Promise.resolve() as Promise<void>,
  // Reassigned per-test; when non-null, schedule compose throws.
  scheduleThrow: null as Error | null,
  // Reassigned per-test; when non-null, workflow compose throws.
  workflowThrow: null as Error | null,
  // Append-only close() call log to assert ordering.
  sequence: [] as string[],
  // Captured `getModule` thunk handed to the coord runner — the
  // workspace-context fixes the workflow module ref AFTER
  // composeWorkflowModule returns, so the thunk must resolve to
  // a non-null module post-compose.
  capturedGetModule: null as (() => WorkflowModule) | null,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@glyphs-ai/catalog", () => ({
  composeCatalog: vi.fn(
    () =>
      ({
        close: vi.fn(async () => {
          mocks.sequence.push("catalog");
        }),
      }) as unknown as CatalogModule,
  ),
}));

vi.mock("@glyphs-ai/session", () => ({
  composeSessionModule: vi.fn(async () => {
    await mocks.catalogGate;
    return {
      close: vi.fn(async () => {
        mocks.sequence.push("session");
      }),
    };
  }),
}));

vi.mock("@glyphs-ai/task", () => ({
  composeTaskModule: vi.fn(
    async () =>
      ({
        recoverOrphanedTasks: {
          execute: vi.fn(() => okAsync(undefined)),
        },
        liveCount: vi.fn(() => 0),
        shutdown: vi.fn(async () => undefined),
        drainPurges: vi.fn(async () => undefined),
        close: vi.fn(async () => {
          mocks.sequence.push("task");
        }),
      }) as unknown as TaskModule,
  ),
}));

vi.mock("@glyphs-ai/schedule", () => ({
  composeScheduleModule: vi.fn(async () => {
    if (mocks.scheduleThrow !== null) throw mocks.scheduleThrow;
    return {
      engine: {
        registerKind: vi.fn(() => ok(undefined)),
        recover: vi.fn(() => okAsync(undefined)),
      },
      close: vi.fn(async () => {
        mocks.sequence.push("schedule");
      }),
    } as unknown as ScheduleModule;
  }),
}));

// `composeWorkflowModule` is mocked so the test never touches the
// workflow substrate's drizzle handle / engine. The stub captures
// the runners passed in so tests can assert they were constructed
// via `makeCoordNodeRunner` / `makeWorkerNodeRunner` (the workflow
// module is built LAST in compose, FIRST in close).
vi.mock("@glyphs-ai/workflow", () => ({
  composeWorkflowModule: vi.fn(async () => {
    if (mocks.workflowThrow !== null) throw mocks.workflowThrow;
    return {
      __mock: "workflow",
      close: vi.fn(async () => {
        mocks.sequence.push("workflow");
      }),
    } as unknown as WorkflowModule;
  }),
}));

// The coord-runner factory dereferences `tasks` / `catalog` only on
// dispatch, so the test stubs are safe to pass through. We capture
// `getModule` so a separate assertion can verify the two-phase
// init: the thunk must resolve to a non-null `WorkflowModule`
// AFTER `composeWorkflowModule` returns.
vi.mock("../src/wiring/workflow-coord-task-runner.js", () => ({
  makeCoordNodeRunner: vi.fn((deps: { getModule: () => WorkflowModule }) => {
    mocks.capturedGetModule = deps.getModule;
    return {
      validate: vi.fn(),
      dispatch: vi.fn(),
      hasInFlightForNode: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock("../src/wiring/workflow-worker-task-runner.js", () => ({
  makeWorkerNodeRunner: vi.fn(() => ({
    validate: vi.fn(),
    dispatch: vi.fn(),
    hasInFlightForNode: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { ok, okAsync } from "neverthrow";
import { WorkspaceContextRegistry } from "../src/workspace-context.js";

function makeRegistry(opts: { workspaceExists?: boolean } = {}): WorkspaceContextRegistry {
  const exists = opts.workspaceExists ?? true;
  type Entity = NonNullable<GetWorkspaceResponse>;
  const getWorkspace = {
    execute: vi.fn(({ id }: { id: string }) =>
      exists
        ? okAsync<GetWorkspaceResponse, never>({
            id,
            name: "test",
            workspaceDir: "/tmp/registry-test",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-01T00:00:00.000Z",
          } as Entity)
        : okAsync<GetWorkspaceResponse, never>(null),
    ),
  } as unknown as WorkspaceModule["getWorkspace"];
  return new WorkspaceContextRegistry({
    getWorkspace,
    runtimeRegistry: new InMemoryRuntimeRegistry(),
    spawner: { spawn: () => okAsync({ launcher: "wt" }) },
  });
}

beforeEach(() => {
  mocks.sequence.length = 0;
  mocks.scheduleThrow = null;
  mocks.workflowThrow = null;
  mocks.catalogGate = Promise.resolve();
  mocks.capturedGetModule = null;
});

describe("WorkspaceContextRegistry race semantics", () => {
  it("closeAll drains inflight get() before disposing", async () => {
    const registry = makeRegistry();
    const gate = makeGate();
    mocks.catalogGate = gate.promise;

    // Start a get() whose load() is now blocked at composeCatalog.
    const getP = registry.get("ws-1");

    // closeAll runs concurrently — must NOT race past the inflight
    // load. It reads `this.inflight` synchronously, then awaits the
    // promise before iterating `entries`.
    const closeP = registry.closeAll();

    // Unblock the catalog compose so the load can finish.
    gate.resolve();

    const ctx = await getP;
    await closeP;

    expect(ctx).not.toBeNull();
    // Drain worked: the context's close() ran end-to-end (reverse-
    // of-compose order). Without the drain, closeAll would have
    // iterated an empty `entries` map and the freshly-built context
    // would have been leaked past closeAll's return.
    // Workflow closes FIRST (reverse of compose; the workflow
    // engine's drain dispatches through tasks, so tasks must still
    // be live while workflow drains).
    expect(mocks.sequence).toEqual(["workflow", "schedule", "task", "session", "catalog"]);
    expect(registry.loaded()).toHaveLength(0);
  });

  it("load() cleanup stack runs in reverse on a thrown composeScheduleModule", async () => {
    const registry = makeRegistry();
    mocks.scheduleThrow = new Error("schedule compose exploded");

    await expect(registry.get("ws-2")).rejects.toThrow("schedule compose exploded");

    // Cleanup stack popped in REVERSE of push order. Pushes were
    // catalog -> session -> task; pops run task -> session -> catalog.
    // The thrown schedule module has no close() to run (no handle
    // ever returned). Workflow is composed AFTER schedule and so
    // never gets a handle to close.
    expect(mocks.sequence).toEqual(["task", "session", "catalog"]);
    expect(registry.loaded()).toHaveLength(0);
  });
});

describe("WorkspaceContextRegistry workflow wiring", () => {
  it("exposes workflows on the loaded WorkspaceContext", async () => {
    const registry = makeRegistry();
    const ctx = await registry.get("ws-3");
    expect(ctx).not.toBeNull();
    expect(ctx?.workflows).toBeDefined();
    await registry.closeAll();
  });

  it("close stack runs workflow FIRST then schedule / task / session / catalog", async () => {
    const registry = makeRegistry();
    const ctx = await registry.get("ws-4");
    expect(ctx).not.toBeNull();
    mocks.sequence.length = 0;
    await ctx?.close();
    expect(mocks.sequence).toEqual(["workflow", "schedule", "task", "session", "catalog"]);
  });

  it("load() cleanup stack pops in reverse on a thrown composeWorkflowModule", async () => {
    const registry = makeRegistry();
    mocks.workflowThrow = new Error("workflow compose exploded");
    await expect(registry.get("ws-5")).rejects.toThrow("workflow compose exploded");
    // Workflow is composed AFTER schedule, so when it throws, the
    // cleanup pops schedule -> task -> session -> catalog in reverse.
    expect(mocks.sequence).toEqual(["schedule", "task", "session", "catalog"]);
    expect(registry.loaded()).toHaveLength(0);
  });

  it("two-phase init: getModule() thunk resolves to the workflow module post-compose", async () => {
    const registry = makeRegistry();
    const ctx = await registry.get("ws-6");
    expect(ctx).not.toBeNull();
    // The coord runner's `getModule` thunk was captured at compose
    // time (before the workflow module ref was assigned). Calling
    // it AFTER compose returns must yield the same service object
    // the context exposes — proves the two-phase init seam is wired
    // end-to-end.
    expect(mocks.capturedGetModule).not.toBeNull();
    const resolved = mocks.capturedGetModule?.();
    expect(resolved).toBe(ctx?.workflows);
    await registry.closeAll();
  });
});

describe("WorkspaceContextRegistry peek", () => {
  it('returns "not-registered" for an unknown workspace id without triggering a load', async () => {
    const registry = makeRegistry({ workspaceExists: false });
    const state = await registry.peek("ws-unknown");
    expect(state).toBe("not-registered");
    // Peek MUST NOT have produced a context entry.
    expect(registry.loaded()).toHaveLength(0);
  });

  it('returns "unloaded" for a registered-but-uncached workspace without triggering a load', async () => {
    const registry = makeRegistry();
    const state = await registry.peek("ws-cold");
    expect(state).toBe("unloaded");
    // The whole point of peek: no compose calls, no entries appended.
    expect(registry.loaded()).toHaveLength(0);
    expect(mocks.sequence).toEqual([]);
  });

  it('returns "loading" when a get() is mid-flight', async () => {
    const registry = makeRegistry();
    const gate = makeGate();
    mocks.catalogGate = gate.promise;

    // Start a get whose load is blocked at composeCatalog.
    const getP = registry.get("ws-loading");

    // While the load is in flight, peek MUST report "loading".
    const state = await registry.peek("ws-loading");
    expect(state).toBe("loading");

    // Unblock and let the load complete so the test exits cleanly.
    gate.resolve();
    await getP;
    await registry.closeAll();
  });

  it('returns "cached" after a successful get()', async () => {
    const registry = makeRegistry();
    const ctx = await registry.get("ws-warm");
    expect(ctx).not.toBeNull();
    const state = await registry.peek("ws-warm");
    expect(state).toBe("cached");
    await registry.closeAll();
  });
});
