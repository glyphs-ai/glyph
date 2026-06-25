import { describe, expect, it } from "vitest";
import {
  assertCopilotSdkResolvable,
  type CopilotPreflightDeps,
  CopilotSdkUnavailableError,
} from "../../src/index.js";

function makeDeps(overrides: Partial<CopilotPreflightDeps>): CopilotPreflightDeps {
  const base: CopilotPreflightDeps = {
    resolveSpecifier: () => "file:///fake/node_modules/@github/copilot-sdk/dist/index.js",
  };
  return { ...base, ...overrides };
}

function errnoError(message: string, code: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("assertCopilotSdkResolvable", () => {
  it("returns void when @github/copilot-sdk is resolvable", () => {
    expect(() => assertCopilotSdkResolvable()).not.toThrow();
  });

  it("exports CopilotSdkUnavailableError with the install hint and chained cause", () => {
    const cause = new Error("Cannot find module '@github/copilot-sdk'");
    const err = new CopilotSdkUnavailableError(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CopilotSdkUnavailableError);
    expect(err.name).toBe("CopilotSdkUnavailableError");
    expect(err.message).toContain("@github/copilot-sdk");
    expect(err.message).toContain("npm install");
    expect(err.message).toContain("Cannot find module");
    expect(err.cause).toBe(cause);
  });

  it("wraps resolver errors in CopilotSdkUnavailableError with .cause chained", () => {
    const cause = errnoError("Cannot find package '@github/copilot-sdk'", "ERR_MODULE_NOT_FOUND");
    const deps = makeDeps({
      resolveSpecifier: () => {
        throw cause;
      },
    });
    expect(() => assertCopilotSdkResolvable(deps)).toThrow(CopilotSdkUnavailableError);
    try {
      assertCopilotSdkResolvable(deps);
    } catch (err) {
      expect((err as CopilotSdkUnavailableError).cause).toBe(cause);
    }
  });
});
