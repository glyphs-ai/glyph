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

const { AzureDevOpsFetcher } = await import(
  "../../../../../src/infrastructure/source/fetcher/ado/azure-devops-fetcher.js"
);
const { _resetAdoTokenCache } = await import(
  "../../../../../src/infrastructure/source/fetcher/ado/ado-token.js"
);

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

const ANON_ROUTER = router({
  silentFill: () => fillExitNonZero(),
  interactiveFill: () => fillExitNonZero(),
});

const ORIG_FETCH = globalThis.fetch;
const ORIG_ENV = {
  AZURE_DEVOPS_EXT_PAT: process.env.AZURE_DEVOPS_EXT_PAT,
  AZURE_DEVOPS_PAT: process.env.AZURE_DEVOPS_PAT,
  CI: process.env.CI,
  GLYPH_NON_INTERACTIVE: process.env.GLYPH_NON_INTERACTIVE,
  SYSTEM_ACCESSTOKEN: process.env.SYSTEM_ACCESSTOKEN,
};
const ORIG_EMIT_WARNING = process.emitWarning.bind(process);

let fetchSpy: ReturnType<typeof vi.fn>;
let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

function restoreEnvVar(name: keyof typeof ORIG_ENV): void {
  const value = ORIG_ENV[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  _resetAdoTokenCache();
  spawnState.calls = [];
  spawnState.factory = ANON_ROUTER;
  delete process.env.AZURE_DEVOPS_EXT_PAT;
  delete process.env.AZURE_DEVOPS_PAT;
  delete process.env.SYSTEM_ACCESSTOKEN;
  delete process.env.CI;
  delete process.env.GLYPH_NON_INTERACTIVE;
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  process.emitWarning = (() => {}) as typeof process.emitWarning;
});

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  process.emitWarning = ORIG_EMIT_WARNING;
  stderrSpy?.mockRestore();
  stderrSpy = null;
  restoreEnvVar("AZURE_DEVOPS_EXT_PAT");
  restoreEnvVar("AZURE_DEVOPS_PAT");
  restoreEnvVar("SYSTEM_ACCESSTOKEN");
  restoreEnvVar("CI");
  restoreEnvVar("GLYPH_NON_INTERACTIVE");
});

async function flushFireAndForget(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const SAMPLE_URI = "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/skills/x";

interface FetchCall {
  url: string;
  headers: Headers;
}

type Route =
  | { kind: "json"; body: unknown; status?: number; statusText?: string }
  | { kind: "raw"; body: string | Buffer; status?: number; statusText?: string };

function routeFetch(routes: { match: RegExp; route: Route }[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const hit = routes.find(({ match }) => match.test(url));
    if (hit === undefined) {
      return new Response("unmatched", { status: 599, statusText: "Unmatched" });
    }
    const { route } = hit;
    if (route.kind === "json") {
      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        statusText: route.statusText ?? "OK",
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      statusText: route.statusText ?? "OK",
    });
  });
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  return { calls };
}

async function fetchMap(uri = SAMPLE_URI): Promise<ReadonlyMap<string, Buffer>> {
  return (await new AzureDevOpsFetcher().fetch(uri))._unsafeUnwrap();
}

describe("AzureDevOpsFetcher.matches", () => {
  it("claims dev.azure.com, legacy visualstudio.com, and TFS origins only", () => {
    const fetcher = new AzureDevOpsFetcher();

    expect(fetcher.matches(SAMPLE_URI)).toBe(true);
    expect(fetcher.matches("https://contoso.visualstudio.com/Project/_git/Repo?path=/x")).toBe(
      true,
    );
    expect(fetcher.matches("https://tfs.contoso.local/Project/_git/Repo?path=/x")).toBe(true);
    expect(
      fetcher.matches("https://github.com/glyphs-ai/glyph/tree/main/first-party/skills/x"),
    ).toBe(false);
  });
});

describe("AzureDevOpsFetcher origin grammar", () => {
  it("rejects malformed dev.azure.com origins as OriginInvalid without network or git calls", async () => {
    fetchSpy = vi.fn(async () => new Response("never", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    for (const origin of [
      "not a url",
      "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo",
      "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=",
      "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/x&version=main",
      "https://contoso.visualstudio.com/MyProject/_git/MyRepo?path=/x",
      "https://tfs.contoso.local/MyProject/_git/MyRepo?path=/x",
    ]) {
      const result = await new AzureDevOpsFetcher().fetch(origin);
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.type).toBe("OriginInvalid");
      expect(error.origin).toBe(origin);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawnState.calls).toHaveLength(0);
  });

  it("normalizes a path without a leading slash before calling the Items API", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "pat";
    const { calls } = routeFetch([
      {
        match: /scopePath=%2Fskills%2Fx&recursionLevel=Full/,
        route: { kind: "json", body: { value: [] } },
      },
      { match: /path=%2Fskills%2Fx&api-version=7\.1/, route: { kind: "raw", body: "single" } },
    ]);

    const files = await fetchMap("https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=skills/x");

    expect(files.get("x")?.toString("utf8")).toBe("single");
    expect(calls[0]?.url).toContain("scopePath=%2Fskills%2Fx");
  });
});

describe("AzureDevOpsFetcher Items API transport", () => {
  it("lists a tree, filters blobs, fetches each blob, and returns relative paths", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "pat";
    const { calls } = routeFetch([
      {
        match: /scopePath=%2Fskills%2Fx&recursionLevel=Full&api-version=7\.1/,
        route: {
          kind: "json",
          body: {
            value: [
              { path: "/skills/x", gitObjectType: "tree" },
              { path: "/skills/x/SKILL.md", gitObjectType: "blob" },
              { path: "/skills/x/lib", gitObjectType: "tree" },
              { path: "/skills/x/lib/util.ts", gitObjectType: "blob" },
            ],
          },
        },
      },
      {
        match: /path=%2Fskills%2Fx%2FSKILL\.md&api-version=7\.1/,
        route: { kind: "raw", body: "# skill\n" },
      },
      {
        match: /path=%2Fskills%2Fx%2Flib%2Futil\.ts&api-version=7\.1/,
        route: { kind: "raw", body: "export {};\n" },
      },
    ]);

    const files = await fetchMap();

    expect([...files.keys()].sort()).toEqual(["SKILL.md", "lib/util.ts"]);
    expect(files.get("SKILL.md")?.toString("utf8")).toBe("# skill\n");
    expect(files.get("lib/util.ts")?.toString("utf8")).toBe("export {};\n");
    expect(calls).toHaveLength(3);
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
    expect(calls[1]?.headers.get("accept")).toBe("application/octet-stream");
  });

  it("falls back to a single-file fetch when the listing is empty", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "pat";
    routeFetch([
      {
        match: /scopePath=%2Fmcps%2Ffoo\.json&recursionLevel=Full/,
        route: { kind: "json", body: { value: [] } },
      },
      {
        match: /path=%2Fmcps%2Ffoo\.json&api-version=7\.1/,
        route: { kind: "raw", body: '{"name":"foo"}' },
      },
    ]);

    const files = await fetchMap(
      "https://dev.azure.com/MyOrg/MyProject/_git/MyRepo?path=/mcps/foo.json",
    );

    expect([...files.keys()]).toEqual(["foo.json"]);
    expect(files.get("foo.json")?.toString("utf8")).toBe('{"name":"foo"}');
  });

  it("returns SourceUnavailable when the listing has no blobs under the requested path", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "pat";
    routeFetch([
      {
        match: /scopePath=%2Fskills%2Fx&recursionLevel=Full/,
        route: {
          kind: "json",
          body: { value: [{ path: "/skills/y/SKILL.md", gitObjectType: "blob" }] },
        },
      },
    ]);

    const result = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("SourceUnavailable");
    if (error.type === "SourceUnavailable") {
      expect(String(error.cause)).toContain("matched no blobs");
    }
  });

  it.each([401, 403, 404])("maps Items API %s to SourceUnavailable", async (status) => {
    process.env.AZURE_DEVOPS_EXT_PAT = "pat";
    routeFetch([
      {
        match: /scopePath=%2Fskills%2Fx&recursionLevel=Full/,
        route: { kind: "raw", body: "nope", status, statusText: "Nope" },
      },
    ]);

    const result = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("SourceUnavailable");
    expect(error.origin).toBe(SAMPLE_URI);
    if (error.type === "SourceUnavailable") {
      expect(String(error.cause)).toContain(`ADO Items API ${status}`);
    }
  });

  it("maps fetch rejections to SourceUnavailable", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "ado_network_secret";
    fetchSpy = vi.fn(async () => {
      throw new Error("ECONNRESET from dev.azure.com");
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const result = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("SourceUnavailable");
    if (error.type === "SourceUnavailable") {
      expect(String(error.cause)).toContain("ECONNRESET");
      expect(String(error.cause)).not.toContain("ado_network_secret");
    }
  });
});

describe("AzureDevOpsFetcher authorization and credential confirmation", () => {
  it("sends Basic auth for env tokens and never invokes git", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "env-secret";
    const { calls } = routeFetch([
      { match: /scopePath=/, route: { kind: "json", body: { value: [] } } },
      { match: /path=%2Fskills%2Fx&api-version=7\.1/, route: { kind: "raw", body: "single" } },
    ]);
    spawnState.factory = () => {
      throw new Error("env token path must not spawn git");
    };

    await fetchMap();

    const expected = `Basic ${Buffer.from(":env-secret", "utf8").toString("base64")}`;
    expect(calls[0]?.headers.get("authorization")).toBe(expected);
    expect(calls[1]?.headers.get("authorization")).toBe(expected);
    expect(spawnState.calls).toHaveLength(0);
  });

  it("omits Authorization when no env or git credential is available", async () => {
    const { calls } = routeFetch([
      { match: /scopePath=/, route: { kind: "json", body: { value: [] } } },
      { match: /path=%2Fskills%2Fx&api-version=7\.1/, route: { kind: "raw", body: "single" } },
    ]);

    await fetchMap();

    expect(calls[0]?.headers.get("authorization")).toBeNull();
    expect(
      spawnState.calls.filter((call) => isApprove(call.args) || isReject(call.args)),
    ).toHaveLength(0);
  });

  it("approves git-credential tokens on every successful Items API response", async () => {
    spawnState.factory = router({
      silentFill: () => fillSuccess(["username=u@x.com\npassword=git-token\n"]),
    });
    routeFetch([
      {
        match: /scopePath=/,
        route: {
          kind: "json",
          body: {
            value: [
              { path: "/skills/x/a.md", gitObjectType: "blob" },
              { path: "/skills/x/b.md", gitObjectType: "blob" },
            ],
          },
        },
      },
      { match: /path=%2Fskills%2Fx%2Fa\.md&api-version=7\.1/, route: { kind: "raw", body: "a" } },
      { match: /path=%2Fskills%2Fx%2Fb\.md&api-version=7\.1/, route: { kind: "raw", body: "b" } },
    ]);

    const files = await fetchMap();
    await flushFireAndForget();

    expect(files.size).toBe(2);
    expect(spawnState.calls.filter((call) => isSilentFill(call.args))).toHaveLength(1);
    const approvals = spawnState.calls.filter((call) => isApprove(call.args));
    expect(approvals).toHaveLength(3);
    expect(approvals[0]?.stdin).toContain("username=u@x.com");
    expect(approvals[0]?.stdin).toContain("password=git-token");
    expect(spawnState.calls.filter((call) => isReject(call.args))).toHaveLength(0);
  });

  it("rejects git-credential tokens and invalidates the cache on 401 and 403", async () => {
    let tokenNumber = 0;
    spawnState.factory = router({
      silentFill: () => {
        tokenNumber += 1;
        return fillSuccess([`username=u@x.com\npassword=git-token-${tokenNumber}\n`]);
      },
    });
    routeFetch([
      {
        match: /scopePath=/,
        route: { kind: "raw", body: "nope", status: 401, statusText: "Unauthorized" },
      },
    ]);

    const first = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);
    await flushFireAndForget();

    expect(first._unsafeUnwrapErr().type).toBe("SourceUnavailable");
    const rejectsAfter401 = spawnState.calls.filter((call) => isReject(call.args));
    expect(rejectsAfter401).toHaveLength(1);
    expect(rejectsAfter401[0]?.stdin).toContain("password=git-token-1");

    routeFetch([
      {
        match: /scopePath=/,
        route: { kind: "raw", body: "nope", status: 403, statusText: "Forbidden" },
      },
    ]);
    const second = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);
    await flushFireAndForget();

    expect(second._unsafeUnwrapErr().type).toBe("SourceUnavailable");
    const silentFills = spawnState.calls.filter((call) => isSilentFill(call.args));
    expect(silentFills).toHaveLength(2);
    const rejectsAfter403 = spawnState.calls.filter((call) => isReject(call.args));
    expect(rejectsAfter403).toHaveLength(2);
    expect(rejectsAfter403[1]?.stdin).toContain("password=git-token-2");
  });

  it("does not reject git-credential tokens on 404 or 500", async () => {
    for (const status of [404, 500]) {
      _resetAdoTokenCache();
      spawnState.calls = [];
      spawnState.factory = router({
        silentFill: () => fillSuccess(["username=u@x.com\npassword=git-token\n"]),
      });
      routeFetch([
        { match: /scopePath=/, route: { kind: "raw", body: "nope", status, statusText: "Nope" } },
      ]);

      const result = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);
      await flushFireAndForget();

      expect(result._unsafeUnwrapErr().type).toBe("SourceUnavailable");
      expect(spawnState.calls.filter((call) => isReject(call.args))).toHaveLength(0);
      expect(spawnState.calls.filter((call) => isApprove(call.args))).toHaveLength(0);
    }
  });
});

describe("AzureDevOpsFetcher token redaction", () => {
  it("does not include token bytes or authorization bytes in HTTP error causes", async () => {
    process.env.AZURE_DEVOPS_EXT_PAT = "ado_supersecret_DO_NOT_LEAK_424242";
    routeFetch([
      {
        match: /scopePath=/,
        route: {
          kind: "raw",
          body: "body with unrelated text",
          status: 404,
          statusText: "Not Found",
        },
      },
    ]);

    const result = await new AzureDevOpsFetcher().fetch(SAMPLE_URI);

    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("SourceUnavailable");
    const causeText = error.type === "SourceUnavailable" ? String(error.cause) : "";
    expect(causeText).toContain("404");
    expect(causeText).not.toContain("ado_supersecret_DO_NOT_LEAK_424242");
    expect(causeText).not.toContain(
      Buffer.from(":ado_supersecret_DO_NOT_LEAK_424242", "utf8").toString("base64"),
    );
  });
});
