import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter | null;
  stdin: { write: (data: string, cb?: (err?: Error) => void) => boolean; end: () => void } | null;
  kill(signal?: string): boolean;
}

interface SpawnCall {
  cmd: string;
  args: string[];
  opts: { env?: NodeJS.ProcessEnv; stdio?: unknown; windowsHide?: boolean };
  stdin: string;
}

type SpawnFactory = (call: SpawnCall) => MockChildProcess;

const spawnState = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  factory: null as SpawnFactory | null,
}));

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], opts: SpawnCall["opts"]) => {
    if (spawnState.factory === null) throw new Error("test forgot to install spawnFactory");
    const call: SpawnCall = { cmd, args, opts: opts ?? {}, stdin: "" };
    spawnState.calls.push(call);
    const child = spawnState.factory(call);
    const stdin = child.stdin;
    if (stdin !== null) {
      const write = stdin.write.bind(stdin);
      stdin.write = (data: string, cb?: (err?: Error) => void): boolean => {
        call.stdin += data;
        return write(data, cb);
      };
    }
    return child;
  },
}));

const {
  _resetAdoTokenCache,
  gitCredentialApprove,
  gitCredentialReject,
  invalidateAdoTokenCache,
  resolveDefaultAdoToken,
  tryGitCredentialFill,
} = await import("../../../../../src/infrastructure/source/fetcher/ado/ado-token.js");

function makeMockChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = null;
  child.stdin = {
    write: vi.fn((_data: string, cb?: (err?: Error) => void): boolean => {
      cb?.();
      return true;
    }),
    end: vi.fn(),
  };
  child.kill = vi.fn((_signal?: string) => true) as MockChildProcess["kill"];
  return child;
}

function fillSuccess(chunks: string[]): MockChildProcess {
  const child = makeMockChild();
  const stdout = new EventEmitter();
  child.stdout = stdout;
  queueMicrotask(() => {
    for (const chunk of chunks) stdout.emit("data", Buffer.from(chunk));
    child.emit("close", 0);
  });
  return child;
}

function fillExitNonZero(code = 1): MockChildProcess {
  const child = makeMockChild();
  child.stdout = new EventEmitter();
  queueMicrotask(() => child.emit("close", code));
  return child;
}

function confirmSuccess(): MockChildProcess {
  const child = makeMockChild();
  child.stdout = new EventEmitter();
  queueMicrotask(() => child.emit("close", 0));
  return child;
}

function confirmExitNonZero(code = 7): MockChildProcess {
  const child = makeMockChild();
  child.stdout = new EventEmitter();
  queueMicrotask(() => child.emit("close", code));
  return child;
}

const isSilentFill = (args: string[]): boolean =>
  args.includes("fill") && args.includes("credential.interactive=false");
const isInteractiveFill = (args: string[]): boolean =>
  args.includes("fill") && !args.includes("credential.interactive=false");
const isApprove = (args: string[]): boolean => args.includes("approve");
const isReject = (args: string[]): boolean => args.includes("reject");

interface RouteSpec {
  silentFill?: () => MockChildProcess;
  interactiveFill?: () => MockChildProcess;
  approve?: () => MockChildProcess;
  reject?: () => MockChildProcess;
}

function router(spec: RouteSpec): SpawnFactory {
  return (call): MockChildProcess => {
    if (isApprove(call.args)) return (spec.approve ?? confirmSuccess)();
    if (isReject(call.args)) return (spec.reject ?? confirmSuccess)();
    if (isSilentFill(call.args)) return (spec.silentFill ?? fillExitNonZero)();
    if (isInteractiveFill(call.args)) return (spec.interactiveFill ?? fillExitNonZero)();
    throw new Error(`unrouted spawn argv: ${JSON.stringify(call.args)}`);
  };
}

const ORIG_ENV = {
  AZURE_DEVOPS_EXT_PAT: process.env.AZURE_DEVOPS_EXT_PAT,
  AZURE_DEVOPS_PAT: process.env.AZURE_DEVOPS_PAT,
  CI: process.env.CI,
  GLYPH_NON_INTERACTIVE: process.env.GLYPH_NON_INTERACTIVE,
  SYSTEM_ACCESSTOKEN: process.env.SYSTEM_ACCESSTOKEN,
};
const ORIG_EMIT_WARNING = process.emitWarning.bind(process);

let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;
let stderrChunks: string[] = [];
const warnings: { msg: string; code?: string }[] = [];

function restoreEnvVar(name: keyof typeof ORIG_ENV): void {
  const value = ORIG_ENV[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  _resetAdoTokenCache();
  spawnState.calls = [];
  spawnState.factory = null;
  warnings.length = 0;
  stderrChunks = [];
  delete process.env.AZURE_DEVOPS_EXT_PAT;
  delete process.env.AZURE_DEVOPS_PAT;
  delete process.env.SYSTEM_ACCESSTOKEN;
  delete process.env.CI;
  delete process.env.GLYPH_NON_INTERACTIVE;
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown): boolean => {
    stderrChunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk as Buffer).toString("utf8"),
    );
    return true;
  }) as never);
  process.emitWarning = ((msg: unknown, opts?: unknown): void => {
    const code =
      typeof opts === "object" && opts !== null ? (opts as { code?: string }).code : undefined;
    warnings.push(code === undefined ? { msg: String(msg) } : { msg: String(msg), code });
  }) as typeof process.emitWarning;
  vi.useRealTimers();
});

afterEach(() => {
  process.emitWarning = ORIG_EMIT_WARNING;
  stderrSpy?.mockRestore();
  stderrSpy = null;
  restoreEnvVar("AZURE_DEVOPS_EXT_PAT");
  restoreEnvVar("AZURE_DEVOPS_PAT");
  restoreEnvVar("SYSTEM_ACCESSTOKEN");
  restoreEnvVar("CI");
  restoreEnvVar("GLYPH_NON_INTERACTIVE");
  vi.useRealTimers();
});

describe("resolveDefaultAdoToken env precedence", () => {
  it("uses AZURE_DEVOPS_EXT_PAT before the other env tokens and never invokes git", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "primary";
    process.env.AZURE_DEVOPS_PAT = "secondary";
    process.env.SYSTEM_ACCESSTOKEN = "tertiary";

    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "env",
      token: "primary",
    });
    expect(spawnState.calls).toHaveLength(0);
  });

  it("falls back through AZURE_DEVOPS_PAT and SYSTEM_ACCESSTOKEN", async () => {
    process.env.AZURE_DEVOPS_PAT = "pat";
    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "env",
      token: "pat",
    });

    delete process.env.AZURE_DEVOPS_PAT;
    process.env.SYSTEM_ACCESSTOKEN = "system";
    await expect(resolveDefaultAdoToken("MyOrg", "OtherRepo")).resolves.toEqual({
      source: "env",
      token: "system",
    });
    expect(spawnState.calls).toHaveLength(0);
  });

  it("re-reads env tokens on every call instead of returning the cached git credential", async () => {
    spawnState.factory = router({
      silentFill: () => fillSuccess(["username=u\npassword=fromgit\n"]),
    });
    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "git-credential",
      token: "fromgit",
      username: "u",
    });

    process.env.AZURE_DEVOPS_EXT_PAT = "env-now";
    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "env",
      token: "env-now",
    });
  });

  it("emits the env-token notice once per org and repo until the cache is reset", async () => {
    process.env.AZURE_DEVOPS_PAT = "envtok";

    await resolveDefaultAdoToken("OrgA", "RepoA");
    await resolveDefaultAdoToken("OrgA", "RepoA");
    await resolveDefaultAdoToken("OrgA", "RepoB");

    const notices = stderrChunks
      .join("")
      .split(/\r?\n/)
      .filter((line) => line.includes("[glyph] using ADO token from environment"));
    expect(notices).toHaveLength(2);

    _resetAdoTokenCache();
    await resolveDefaultAdoToken("OrgA", "RepoA");
    expect(stderrChunks.join("")).toContain("dev.azure.com/OrgA/RepoA");
  });
});

describe("resolveDefaultAdoToken git credential flow", () => {
  it("uses a silent peek first and returns the git credential without interactive stderr", async () => {
    spawnState.factory = router({
      silentFill: () => fillSuccess(["protocol=https\nusername=u@x.com\npassword=tok\n\n"]),
    });

    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "git-credential",
      token: "tok",
      username: "u@x.com",
    });

    expect(spawnState.calls).toHaveLength(1);
    expect(spawnState.calls[0]?.cmd).toBe("git");
    expect(spawnState.calls[0]?.args).toContain("credential.interactive=false");
    expect(spawnState.calls[0]?.opts.env?.GCM_INTERACTIVE).toBe("Never");
    expect(spawnState.calls[0]?.stdin).toContain("path=MyOrg/_git/MyRepo");
    expect(stderrChunks.join("")).toBe("");
  });

  it("falls back to interactive fill when silent peek returns no credential", async () => {
    spawnState.factory = router({
      silentFill: () => fillExitNonZero(),
      interactiveFill: () => fillSuccess(["username=user@example.com\npassword=popup-token\n"]),
    });

    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).resolves.toEqual({
      source: "git-credential",
      token: "popup-token",
      username: "user@example.com",
    });
    expect(spawnState.calls.filter((call) => isSilentFill(call.args))).toHaveLength(1);
    expect(spawnState.calls.filter((call) => isInteractiveFill(call.args))).toHaveLength(1);
    expect(stderrChunks.join("")).toContain("Microsoft sign-in window may appear");
  });

  it("does not spawn interactive fill when CI explicitly opts out", async () => {
    process.env.CI = "true";
    spawnState.factory = router({ silentFill: () => fillExitNonZero() });

    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).rejects.toThrow(/AZURE_DEVOPS_PAT/);
    expect(spawnState.calls.filter((call) => isInteractiveFill(call.args))).toHaveLength(0);
  });

  it("does not spawn interactive fill when GLYPH_NON_INTERACTIVE explicitly opts out", async () => {
    process.env.GLYPH_NON_INTERACTIVE = "1";
    spawnState.factory = router({ silentFill: () => fillExitNonZero() });

    await expect(resolveDefaultAdoToken("MyOrg", "MyRepo")).rejects.toThrow(/git ls-remote/);
    expect(spawnState.calls.filter((call) => isInteractiveFill(call.args))).toHaveLength(0);
  });

  it("caches successful and null git results by org and repo", async () => {
    let n = 0;
    spawnState.factory = router({
      silentFill: () => {
        n += 1;
        return fillSuccess([`username=u\npassword=tok_${n}\n`]);
      },
    });

    const first = await resolveDefaultAdoToken("MyOrg", "MyRepo");
    const second = await resolveDefaultAdoToken("MyOrg", "MyRepo");
    const other = await resolveDefaultAdoToken("MyOrg", "OtherRepo");

    expect(first?.token).toBe("tok_1");
    expect(second?.token).toBe("tok_1");
    expect(other?.token).toBe("tok_2");
    expect(spawnState.calls.filter((call) => isSilentFill(call.args))).toHaveLength(2);
  });

  it("deduplicates concurrent cold-cache callers through one in-flight fill", async () => {
    spawnState.factory = router({
      silentFill: () => {
        const child = makeMockChild();
        const stdout = new EventEmitter();
        child.stdout = stdout;
        setTimeout(() => {
          stdout.emit("data", Buffer.from("username=u\npassword=tok\n"));
          child.emit("close", 0);
        }, 10);
        return child;
      },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => resolveDefaultAdoToken("MyOrg", "MyRepo")),
    );

    expect(results).toEqual(
      Array.from({ length: 8 }, () => ({ source: "git-credential", token: "tok", username: "u" })),
    );
    expect(spawnState.calls.filter((call) => isSilentFill(call.args))).toHaveLength(1);
  });

  it("invalidateAdoTokenCache clears only the targeted org and repo", async () => {
    let n = 0;
    spawnState.factory = router({
      silentFill: () => {
        n += 1;
        return fillSuccess([`username=u\npassword=t${n}\n`]);
      },
    });

    await resolveDefaultAdoToken("Org", "RepoA");
    await resolveDefaultAdoToken("Org", "RepoB");
    invalidateAdoTokenCache("Org", "RepoA");

    expect((await resolveDefaultAdoToken("Org", "RepoB"))?.token).toBe("t2");
    expect((await resolveDefaultAdoToken("Org", "RepoA"))?.token).toBe("t3");
  });
});

describe("tryGitCredentialFill", () => {
  it("invokes the interactive git credential fill and parses username/password", async () => {
    spawnState.factory = () => fillSuccess(["protocol=https\nusername=foo\npassword=secret\n\n"]);

    await expect(tryGitCredentialFill("MyOrg", "MyRepo")).resolves.toEqual({
      username: "foo",
      password: "secret",
    });
    expect(spawnState.calls[0]?.args).toEqual([
      "-c",
      "credential.useHttpPath=true",
      "credential",
      "fill",
    ]);
    expect(spawnState.calls[0]?.opts.env).toBeUndefined();
    expect(spawnState.calls[0]?.stdin).toContain("path=MyOrg/_git/MyRepo");
  });

  it("returns null for non-zero exits, spawn throws, error events, and missing passwords", async () => {
    spawnState.factory = () => fillExitNonZero();
    await expect(tryGitCredentialFill("MyOrg", "MyRepo")).resolves.toBeNull();

    spawnState.factory = () => {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    };
    await expect(tryGitCredentialFill("MyOrg", "MyRepo")).resolves.toBeNull();

    spawnState.factory = () => {
      const child = makeMockChild();
      queueMicrotask(() => child.emit("error", new Error("EPERM")));
      return child;
    };
    await expect(tryGitCredentialFill("MyOrg", "MyRepo")).resolves.toBeNull();

    spawnState.factory = () => fillSuccess(["username=u\npassword=\n"]);
    await expect(tryGitCredentialFill("MyOrg", "MyRepo")).resolves.toBeNull();
  });

  it("kills a hanging interactive fill only after the 120s bound", async () => {
    let killed = false;
    spawnState.factory = () => {
      const child = makeMockChild();
      child.stdout = new EventEmitter();
      child.kill = vi.fn((_signal?: string) => {
        killed = true;
        return true;
      }) as MockChildProcess["kill"];
      return child;
    };
    vi.useFakeTimers();

    const pending = tryGitCredentialFill("MyOrg", "MyRepo");
    await vi.advanceTimersByTimeAsync(119_999);
    expect(killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(killed).toBe(true);
  });
});

describe("git credential approve and reject", () => {
  it("approve writes the full credential block and swallows successful completion", async () => {
    spawnState.factory = router({ approve: () => confirmSuccess() });

    await expect(
      gitCredentialApprove("MyOrg", "MyRepo", "u@x.com", "tokABC"),
    ).resolves.toBeUndefined();

    expect(spawnState.calls[0]?.args).toEqual([
      "-c",
      "credential.useHttpPath=true",
      "credential",
      "approve",
    ]);
    expect(spawnState.calls[0]?.stdin).toContain("path=MyOrg/_git/MyRepo");
    expect(spawnState.calls[0]?.stdin).toContain("username=u@x.com");
    expect(spawnState.calls[0]?.stdin).toContain("password=tokABC");
    expect(warnings).toHaveLength(0);
  });

  it("reject writes the full credential block and swallows successful completion", async () => {
    spawnState.factory = router({ reject: () => confirmSuccess() });

    await expect(
      gitCredentialReject("MyOrg", "MyRepo", "u@x.com", "tokABC"),
    ).resolves.toBeUndefined();

    expect(spawnState.calls[0]?.args).toEqual([
      "-c",
      "credential.useHttpPath=true",
      "credential",
      "reject",
    ]);
    expect(spawnState.calls[0]?.stdin).toContain("username=u@x.com");
    expect(spawnState.calls[0]?.stdin).toContain("password=tokABC");
    expect(warnings).toHaveLength(0);
  });

  it("approve and reject emit warnings instead of throwing on spawn failures", async () => {
    spawnState.factory = router({ approve: () => confirmExitNonZero(7) });
    await expect(gitCredentialApprove("MyOrg", "MyRepo", "u", "p")).resolves.toBeUndefined();

    spawnState.factory = () => {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    };
    await expect(gitCredentialReject("MyOrg", "MyRepo", "u", "p")).resolves.toBeUndefined();

    expect(warnings.some((warning) => warning.code === "GLYPH_GCM_APPROVE_FAILED")).toBe(true);
    expect(warnings.some((warning) => warning.code === "GLYPH_GCM_REJECT_FAILED")).toBe(true);
  });
});
