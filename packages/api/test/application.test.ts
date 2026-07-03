/**
 * Tests for `@glyphs-ai/api`. Coverage is focused on the orchestration
 * surface (`Application`) and the per-workspace context registry
 * lifecycle invariants the package owns:
 *
 *   - composeApplication rejects misconfiguration (relative
 *     defaultWorkspaceParent)
 *   - register mints a uuid, defaults the dir, persists
 *   - unregisterWorkspace + renameWorkspace invalidate the per-workspace
 *     context
 *   - Application.getContext dedupes concurrent loads via the internal
 *     registry's inflight map
 *   - Application.reloadWorkspace refuses when live tasks exist and
 *     drains inflight loads
 *
 * Tests use real composeWorkspaceModule against `:memory:` plus a
 * minimal stub Runtime registered through the real RuntimeRegistry so
 * composeSessionModule / composeTaskModule succeed.
 *
 * Registry-internal race semantics (closeAll drain, partial load
 * rollback) are pinned in `workspace-context.test.ts`, which imports
 * `WorkspaceContextRegistry` via a relative path.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Runtime, RuntimeCapabilities } from "@glyphs-ai/runtime";
import { InMemoryRuntimeRegistry, type RuntimeRegistry } from "@glyphs-ai/runtime";
import type { WorkspaceName } from "@glyphs-ai/workspace";
import type { Result, ResultAsync } from "neverthrow";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Application,
  composeApplication,
  WorkspaceHasLiveTasksError,
  WorkspaceLoadError,
} from "../src/index.js";

/**
 * Test helper: drain a `ResultAsync` and unwrap the `Ok` value, raising
 * a synthetic Error if the chain resolved as `Err`. Tests use it
 * wherever they would have written `await service.X(...)` before
 * Phase 3b — the result-flavoured call sites are a side-effect of the
 * @glyphs-ai/workspace error-channel refactor, not what these tests
 * are about.
 */
async function ok<T, E>(r: ResultAsync<T, E> | Promise<Result<T, E>>): Promise<T> {
  const res = await r;
  if (res.isErr()) throw new Error(`unexpected Err: ${JSON.stringify(res.error)}`);
  return res.value;
}

// Minimal Runtime stub: the registry's load() path constructs session +
// task modules whose composers require a runtime to be registered, but
// the modules don't actually CALL it at compose time — only at
// dispatch/launch time, which our tests don't reach. A bare stub is
// enough to satisfy the runtime-registry lookup.
class StubRuntime implements Runtime {
  readonly kind = "copilot";
  readonly capabilities: RuntimeCapabilities = { remoteSession: true };
  // Every method exists but is never called by the tests; the
  // dispatch/launch paths they would drive are never reached. The
  // behavioural methods return an `err` atom so an unexpected call
  // surfaces loudly on the Result rail; the best-effort readers return
  // empty.
  provision() {
    return errAsync({
      type: "RuntimeProvisionFailed" as const,
      cause: new Error("StubRuntime.provision: not implemented for tests"),
    });
  }
  buildInteractiveLaunch() {
    return errAsync({
      type: "RuntimeLaunchFailed" as const,
      cause: new Error("StubRuntime.buildInteractiveLaunch: not implemented"),
    });
  }
  launchHeadless() {
    return errAsync({
      type: "RuntimeHeadlessLaunchFailed" as const,
      cause: new Error("StubRuntime.launchHeadless: not implemented"),
    });
  }
  readMetadata() {
    return okAsync(null);
  }
  readActivity() {
    return okAsync(null);
  }
  async *streamActivity() {
    // empty
  }
  deleteState() {
    return okAsync(undefined);
  }
}

function makeRegistry(): RuntimeRegistry {
  const reg = new InMemoryRuntimeRegistry();
  reg.register(new StubRuntime());
  return reg;
}

let scratch: string;
const apps: Application[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "api-test-"));
});

afterEach(async () => {
  for (const a of apps.splice(0)) {
    try {
      await a.close();
    } catch {
      /* best-effort */
    }
  }
  await rm(scratch, { recursive: true, force: true });
});

async function makeApp(): Promise<Application> {
  const app = await composeApplication({
    workspace: {
      dbUrl: ":memory:",
      defaultWorkspaceParent: path.join(scratch, "workspaces"),
    },
    runtimeRegistry: makeRegistry(),
  });
  apps.push(app);
  return app;
}

describe("composeApplication", () => {
  it("rejects a relative defaultWorkspaceParent", async () => {
    await expect(
      composeApplication({
        workspace: { dbUrl: ":memory:", defaultWorkspaceParent: "relative/path" },
        runtimeRegistry: makeRegistry(),
      }),
    ).rejects.toThrow(/absolute/);
  });

  it("accepts an absolute defaultWorkspaceParent", async () => {
    const a = await makeApp();
    expect(a).toBeDefined();
  });
});

describe("Application orchestration", () => {
  it("register mints a uuid and uses defaultWorkspaceParent when dir is omitted", async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    expect(ws.id).toMatch(/^[0-9a-f]{8}-/);
    expect(ws.workspaceDir.startsWith(path.join(scratch, "workspaces"))).toBe(true);
    expect(ws.workspaceDir.endsWith(ws.id)).toBe(true);
    expect(ws.name).toBe("demo");
    // Re-read via workspaceService confirms persistence
    const view = await ok(app.workspace.getWorkspace.execute({ id: ws.id }));
    expect(view?.name).toBe("demo");
  });

  it("register honours an explicit workspaceDir", async () => {
    const app = await makeApp();
    const dir = path.join(scratch, "explicit");
    const ws = await ok(
      app.workspace.registerWorkspace.execute({
        name: "explicit" as WorkspaceName,
        workspaceDir: dir,
      }),
    );
    expect(ws.workspaceDir).toBe(path.resolve(dir));
  });

  it("renameWorkspace invalidates the per-workspace context", async () => {
    const app = await makeApp();
    const ws = await ok(
      app.workspace.registerWorkspace.execute({ name: "before" as WorkspaceName }),
    );
    // Touch the context once so there's something to invalidate.
    await app.getContext(ws.id);
    expect(app.loadedContexts()).toHaveLength(1);
    const renamed = await ok(app.renameWorkspace(ws.id, { name: "after" as WorkspaceName }));
    expect(renamed?.name).toBe("after");
    expect(app.loadedContexts()).toHaveLength(0);
  });

  it("unregisterWorkspace invalidates the per-workspace context", async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    await app.getContext(ws.id);
    expect(app.loadedContexts()).toHaveLength(1);
    await ok(app.unregisterWorkspace(ws.id));
    expect(app.loadedContexts()).toHaveLength(0);
    expect(await ok(app.workspace.getWorkspace.execute({ id: ws.id }))).toBeNull();
  });

  it("close disposes the registry and the workspace module", async () => {
    const app = await composeApplication({
      workspace: {
        dbUrl: ":memory:",
        defaultWorkspaceParent: path.join(scratch, "workspaces"),
      },
      runtimeRegistry: makeRegistry(),
    });
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    await app.getContext(ws.id);
    expect(app.loadedContexts()).toHaveLength(1);
    await app.close();
    // After close, the registry is empty (closeAll cleared it).
    expect(app.loadedContexts()).toHaveLength(0);
  });
});

describe("Application.getContext", () => {
  it("dedupes concurrent loads", async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    // Spy on the workspaceService.get to count how many times load()
    // actually fetches the workspace — should be exactly once across
    // both concurrent getContext() calls.
    const spy = vi.spyOn(app.workspace.getWorkspace, "execute");
    const [a, b] = await Promise.all([app.getContext(ws.id), app.getContext(ws.id)]);
    expect(a).toBe(b); // same reference — memoised
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("wraps a cold-load failure in WorkspaceLoadError carrying the raw cause", async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    const boom = new Error("workspace.db is unreadable");
    // Force the load() path's `workspaceService.get` to return an
    // `Err(DatabaseUnavailable)` carrying the raw fs/driver failure as
    // its `cause`. The registry's `load()` re-throws that `cause` and
    // the facade wraps it in a typed `WorkspaceLoadError` so every
    // host maps it uniformly.
    const spy = vi
      .spyOn(app.workspace.getWorkspace, "execute")
      .mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: boom }));
    try {
      const rejection = app.getContext(ws.id);
      await expect(rejection).rejects.toBeInstanceOf(WorkspaceLoadError);
      await expect(rejection).rejects.toMatchObject({
        name: "WorkspaceLoadError",
        workspaceId: ws.id,
        cause: boom,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Application.peekContextState", () => {
  it('returns "not-registered" for an unknown workspace id', async () => {
    const app = await makeApp();
    const state = await app.peekContextState("00000000-0000-0000-0000-000000000000");
    expect(state).toBe("not-registered");
    expect(app.loadedContexts()).toHaveLength(0);
  });

  it('returns "unloaded" for a registered-but-uncached workspace', async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    const state = await app.peekContextState(ws.id);
    expect(state).toBe("unloaded");
    // peek MUST NOT have triggered a load.
    expect(app.loadedContexts()).toHaveLength(0);
  });

  it('returns "cached" after a successful getContext()', async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    await app.getContext(ws.id);
    const state = await app.peekContextState(ws.id);
    expect(state).toBe("cached");
  });
});

describe("Application.reloadWorkspace", () => {
  it("returns null when the workspace is absent", async () => {
    const app = await makeApp();
    const result = await app.reloadWorkspace("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("refuses with WorkspaceHasLiveTasksError when live tasks exist", async () => {
    const app = await makeApp();
    const ws = await ok(app.workspace.registerWorkspace.execute({ name: "demo" as WorkspaceName }));
    const ctx = await app.getContext(ws.id);
    if (ctx === null) throw new Error("expected context");
    // Stub liveCount() to fake an in-flight task. The context is the
    // canonical seam — reload reads `cached.tasks.liveCount()`.
    vi.spyOn(ctx.tasks, "liveCount").mockReturnValue(3);
    await expect(app.reloadWorkspace(ws.id)).rejects.toBeInstanceOf(WorkspaceHasLiveTasksError);
  });
});
