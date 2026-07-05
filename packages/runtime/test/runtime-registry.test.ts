import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { Runtime } from "../src/index.js";
import { InMemoryRuntimeRegistry } from "../src/index.js";

function fakeRuntime(kind: string): Runtime {
  return {
    kind,
    provision: () => okAsync({ runtimeSessionId: null }),
    buildInteractiveLaunch: (_runtimeSessionId, opts) =>
      okAsync({ cmd: "noop", args: [], cwd: opts.workdir, display: "noop" }),
    readMetadata: () => okAsync(null),
    deleteState: () => okAsync(undefined),
  };
}

describe("RuntimeRegistry", () => {
  it("registers and retrieves a runtime by kind", () => {
    const reg = new InMemoryRuntimeRegistry();
    const rt = fakeRuntime("copilot");
    reg.register(rt);
    expect(reg.get("copilot")._unsafeUnwrap()).toBe(rt);
  });

  it("returns an UnknownRuntime err when kind is not registered", () => {
    const reg = new InMemoryRuntimeRegistry();
    const result = reg.get("gemini");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("UnknownRuntime");
  });

  it("throws when registering a duplicate kind", () => {
    const reg = new InMemoryRuntimeRegistry();
    reg.register(fakeRuntime("copilot"));
    expect(() => reg.register(fakeRuntime("copilot"))).toThrow(/already registered/);
  });

  it("has() reports membership without throwing", () => {
    const reg = new InMemoryRuntimeRegistry();
    expect(reg.has("copilot")).toBe(false);
    reg.register(fakeRuntime("copilot"));
    expect(reg.has("copilot")).toBe(true);
  });

  it("kinds() returns registration order", () => {
    const reg = new InMemoryRuntimeRegistry();
    reg.register(fakeRuntime("copilot"));
    reg.register(fakeRuntime("gemini"));
    reg.register(fakeRuntime("claude-code"));
    expect(reg.kinds()).toEqual(["copilot", "gemini", "claude-code"]);
  });

  it("kinds() preserves registration order even when it is non-alphabetical", () => {
    const reg = new InMemoryRuntimeRegistry();
    // Register in deliberately non-alphabetical order so a refactor
    // that swapped the underlying store to a Set or sorted output
    // would fail loudly here.
    reg.register(fakeRuntime("zeta"));
    reg.register(fakeRuntime("alpha"));
    reg.register(fakeRuntime("mu"));
    reg.register(fakeRuntime("beta"));
    expect(reg.kinds()).toEqual(["zeta", "alpha", "mu", "beta"]);
  });
});
