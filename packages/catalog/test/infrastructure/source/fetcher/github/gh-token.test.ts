import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `node:child_process` is mocked so no real `gh` process is launched; each
 * test scripts the fake child's stdout, exit, or error.
 */
interface SpawnScript {
  stdout?: string;
  code?: number | null;
  error?: Error;
  hang?: boolean;
}
const { state } = vi.hoisted(() => ({ state: { script: {} as SpawnScript } }));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const s = state.script;
    setImmediate(() => {
      if (s.error) {
        child.emit("error", s.error);
        return;
      }
      if (s.hang) return;
      if (s.stdout !== undefined) child.stdout.emit("data", Buffer.from(s.stdout));
      child.emit("close", s.code ?? 0);
    });
    return child;
  }),
}));

import { spawn } from "node:child_process";
import {
  _resetGhTokenCache,
  resolveDefaultGitHubToken,
  tryGhAuthToken,
} from "../../../../../src/infrastructure/source/fetcher/github/gh-token.js";

const ORIG_GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORIG_GH_TOKEN = process.env.GH_TOKEN;

beforeEach(() => {
  _resetGhTokenCache();
  state.script = {};
  vi.mocked(spawn).mockClear();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIG_GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = ORIG_GITHUB_TOKEN;
  if (ORIG_GH_TOKEN === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = ORIG_GH_TOKEN;
});

describe("resolveDefaultGitHubToken — env precedence", () => {
  it("GITHUB_TOKEN wins without spawning gh", async () => {
    process.env.GITHUB_TOKEN = "env-github";
    expect(await resolveDefaultGitHubToken("github.com")).toBe("env-github");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("falls back to GH_TOKEN", async () => {
    process.env.GH_TOKEN = "env-gh";
    expect(await resolveDefaultGitHubToken("github.com")).toBe("env-gh");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("GITHUB_TOKEN takes precedence over GH_TOKEN", async () => {
    process.env.GITHUB_TOKEN = "primary";
    process.env.GH_TOKEN = "secondary";
    expect(await resolveDefaultGitHubToken("github.com")).toBe("primary");
  });
});

describe("resolveDefaultGitHubToken — gh CLI fallback + cache", () => {
  it("returns a valid gh token and caches it (single spawn within TTL)", async () => {
    const token = `ghp_${"a".repeat(20)}`;
    state.script = { stdout: `${token}\n`, code: 0 };
    expect(await resolveDefaultGitHubToken("github.com")).toBe(token);
    // Second call within the TTL should reuse the cached token.
    state.script = { stdout: "ghp_changed", code: 0 };
    expect(await resolveDefaultGitHubToken("github.com")).toBe(token);
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });

  it("caches a null result too (gh not configured)", async () => {
    state.script = { code: 1 };
    expect(await resolveDefaultGitHubToken("github.com")).toBeNull();
    expect(await resolveDefaultGitHubToken("github.com")).toBeNull();
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });
});

describe("tryGhAuthToken — failure modes return null, never throw", () => {
  it("spawn ENOENT → null", async () => {
    state.script = { error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) };
    expect(await tryGhAuthToken("github.com")).toBeNull();
  });

  it("non-zero exit → null", async () => {
    state.script = { stdout: "ghp_whatever", code: 1 };
    expect(await tryGhAuthToken("github.com")).toBeNull();
  });

  it("stdout not matching the token grammar → null", async () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    state.script = { stdout: "not a token\n", code: 0 };
    expect(await tryGhAuthToken("github.com")).toBeNull();
    warn.mockRestore();
  });

  it("accepts github_pat_ fine-grained tokens", async () => {
    const token = `github_pat_${"x".repeat(10)}`;
    state.script = { stdout: token, code: 0 };
    expect(await tryGhAuthToken("github.com")).toBe(token);
  });

  it("times out when gh hangs → null", async () => {
    vi.useFakeTimers();
    state.script = { hang: true };
    const p = tryGhAuthToken("github.com");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBeNull();
  });
});
