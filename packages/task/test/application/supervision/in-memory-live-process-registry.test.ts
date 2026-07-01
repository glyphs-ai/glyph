import type { RuntimeExit, RuntimeHandle } from "@glyphs-ai/runtime";
import { describe, expect, it } from "vitest";
import type {
  ExitOutcome,
  KillReason,
} from "../../../src/application/ports/live-process-registry.js";
import { InMemoryLiveProcessRegistry } from "../../../src/application/supervision/in-memory-live-process-registry.js";

interface FakeHandle {
  readonly handle: RuntimeHandle;
  resolveExit(exit: RuntimeExit): void;
  rejectExit(cause: unknown): void;
  killCount(): number;
}

function fakeHandle(autoExitOnKill = false): FakeHandle {
  let resolveExit!: (exit: RuntimeExit) => void;
  let rejectExit!: (cause: unknown) => void;
  const exit = new Promise<RuntimeExit>((res, rej) => {
    resolveExit = res;
    rejectExit = rej;
  });
  let kills = 0;
  const handle: RuntimeHandle = {
    runtimeSessionId: "rsid",
    sessionDir: Promise.resolve("/tmp/session"),
    exit,
    kill: () => {
      kills++;
      if (autoExitOnKill) resolveExit({ code: null, signal: "SIGTERM" });
    },
  };
  return { handle, resolveExit, rejectExit, killCount: () => kills };
}

describe("InMemoryLiveProcessRegistry", () => {
  it("runs onExit with the exit info + null killReason on a self-exit, then drops the entry", async () => {
    const registry = new InMemoryLiveProcessRegistry();
    const h = fakeHandle();
    let seen: { outcome: ExitOutcome; killReason: KillReason | null } | undefined;
    registry.supervise("t1", h.handle, async (outcome, killReason) => {
      seen = { outcome, killReason };
    });
    expect(registry.size()).toBe(1);

    h.resolveExit({ code: 0, signal: null });
    await registry.awaitSettled("t1");

    expect(seen?.outcome).toEqual({ kind: "exited", exit: { code: 0, signal: null } });
    expect(seen?.killReason).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it("requestKill is first-wins: killed, then already-killing", async () => {
    const registry = new InMemoryLiveProcessRegistry();
    const h = fakeHandle();
    registry.supervise("t1", h.handle, async () => {});

    expect(registry.requestKill("t1", "cancel")).toBe("killed");
    expect(registry.requestKill("t1", "cancel")).toBe("already-killing");
    expect(h.killCount()).toBe(1);

    h.resolveExit({ code: null, signal: "SIGTERM" });
    await registry.awaitSettled("t1");
  });

  it("requestKill returns not-live for an unknown id", () => {
    const registry = new InMemoryLiveProcessRegistry();
    expect(registry.requestKill("ghost", "cancel")).toBe("not-live");
  });

  it("passes the killReason observed at exit time to onExit", async () => {
    const registry = new InMemoryLiveProcessRegistry();
    const h = fakeHandle();
    let killReason: KillReason | null = null;
    registry.supervise("t1", h.handle, async (_outcome, kr) => {
      killReason = kr;
    });

    registry.requestKill("t1", "shutdown");
    h.resolveExit({ code: null, signal: "SIGTERM" });
    await registry.awaitSettled("t1");

    expect(killReason).toBe("shutdown");
  });

  it("killAll kills + drains every live process", async () => {
    const registry = new InMemoryLiveProcessRegistry();
    const a = fakeHandle(true);
    const b = fakeHandle(true);
    const exited: string[] = [];
    registry.supervise("a", a.handle, async (_o, kr) => {
      exited.push(`a:${kr}`);
    });
    registry.supervise("b", b.handle, async (_o, kr) => {
      exited.push(`b:${kr}`);
    });
    expect(registry.size()).toBe(2);

    await registry.killAll("shutdown");

    expect(registry.size()).toBe(0);
    expect(exited.sort()).toEqual(["a:shutdown", "b:shutdown"]);
    expect(a.killCount()).toBe(1);
  });

  it("surfaces a watch-failed outcome when handle.exit rejects", async () => {
    const registry = new InMemoryLiveProcessRegistry();
    const h = fakeHandle();
    let outcome: ExitOutcome | undefined;
    registry.supervise("t1", h.handle, async (o) => {
      outcome = o;
    });

    h.rejectExit(new Error("boom"));
    await registry.awaitSettled("t1");

    expect(outcome).toEqual({ kind: "watch-failed", cause: expect.any(Error) });
  });
});
