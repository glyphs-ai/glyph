import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { Runtime } from "../src/runtime.js";
import { InMemoryRuntimeRegistry } from "../src/runtime-registry.js";

function fakeRuntime(kind: string): Runtime {
  return {
    kind,
    provision: () => okAsync({ runtimeSessionId: null }),
    buildInteractiveLaunch: () => okAsync({ cmd: "x", args: [], cwd: "/", display: "x" }),
    readMetadata: () => okAsync(null),
    deleteState: () => okAsync(undefined),
  };
}

describe("InMemoryRuntimeRegistry", () => {
  it("registers a runtime and resolves it by kind", () => {
    const reg = new InMemoryRuntimeRegistry();
    const copilot = fakeRuntime("copilot");
    reg.register(copilot);
    expect(reg.has("copilot")).toBe(true);
    expect(reg.get("copilot")._unsafeUnwrap()).toBe(copilot);
    expect(reg.kinds()).toEqual(["copilot"]);
  });

  it("get returns UnknownRuntime for an unregistered kind", () => {
    const reg = new InMemoryRuntimeRegistry();
    expect(reg.has("gemini")).toBe(false);
    expect(reg.get("gemini")._unsafeUnwrapErr()).toEqual({
      type: "UnknownRuntime",
      runtime: "gemini",
    });
  });

  it("throws on duplicate registration (bootstrap-time bug)", () => {
    const reg = new InMemoryRuntimeRegistry();
    reg.register(fakeRuntime("copilot"));
    expect(() => reg.register(fakeRuntime("copilot"))).toThrow(/already registered/);
  });

  it("kinds reflects registration order", () => {
    const reg = new InMemoryRuntimeRegistry();
    reg.register(fakeRuntime("copilot"));
    reg.register(fakeRuntime("gemini"));
    expect(reg.kinds()).toEqual(["copilot", "gemini"]);
  });
});
