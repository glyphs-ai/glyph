/**
 * Regression test for the env-merge contract on the SDK-backed
 * headless launcher.
 *
 * The SDK's `CopilotClient({ env })` REPLACES `process.env` for the
 * spawned CLI subprocess rather than merging. If `launchCopilotHeadless`
 * forwarded `opts.subprocessEnv` as-is, the subprocess would see ONLY
 * glyph's own GLYPH_* additions and lose every system env var
 * (`PATH`, `PATHEXT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, …),
 * which breaks every downstream tool that needs them (`gh` can't reach
 * the Windows Credential Manager without USERPROFILE; `node`/`pnpm`
 * stop resolving against the user's installed toolchain without PATH).
 *
 * `launchCopilotHeadless` therefore merges `subprocessEnv` on top of
 * `process.env` and honours `undefined` overrides as "delete this key
 * from the parent env" (used by `CopilotRuntime.launchHeadless` to
 * translate `CopilotRuntimeConfig.subprocessEnvScrub` —
 * `["GLYPH_HOME"]` in production — into actual deletions before the
 * SDK gets the env bag).
 *
 * This test pins both halves of the contract by stubbing the SDK client
 * to capture the `env` it would have been constructed with, then
 * deliberately throwing from `client.start()` so we don't have to mock
 * the full session lifecycle.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidMcpJson } from "../../src/copilot/errors.js";
import { launchCopilotHeadless } from "../../src/copilot/launch-headless.js";
import { RuntimeHeadlessLaunchFailed } from "../../src/errors.js";
import type { AgentContentSource, ResolvedAgent } from "../../src/types.js";
import { makeFakeContentSource } from "../fixtures/fake-content-source.js";

const FRAMING = "do the thing";

let scratch: string;
let workdir: string;
let stateDir: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "rt-env-merge-"));
  workdir = path.join(scratch, "work");
  stateDir = path.join(scratch, "copilot-state");
  await mkdir(workdir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function buildAgent(): Promise<{ agent: ResolvedAgent; source: AgentContentSource }> {
  const agentBody = "---\nname: demo\ndescription: d\nversion: 0.0.1\n---\n# demo\n";
  const { source } = makeFakeContentSource({
    agents: { demo: { files: { "AGENTS.md": agentBody } } },
  });
  return { agent: await source.resolveAgent("public/demo"), source };
}

function fakeCopilotClient(
  methods: Pick<CopilotClient, "start" | "stop" | "createSession">,
): CopilotClient {
  return Object.assign(Object.create(null), methods) as CopilotClient;
}

function fakeCopilotSession(
  methods: Pick<CopilotSession, "sessionId" | "send" | "disconnect" | "abort">,
): CopilotSession {
  return Object.assign(Object.create(null), methods) as CopilotSession;
}

/**
 * Build a fake CopilotClient that captures the constructor options
 * (so we can assert on `env`) and then throws from `start()` to abort
 * the launch before any real CLI work happens.
 */
function capturingClientFactory(): {
  capture: { env?: NodeJS.ProcessEnv };
  factory: (opts: ConstructorParameters<typeof CopilotClient>[0]) => CopilotClient;
} {
  const capture: { env?: NodeJS.ProcessEnv } = {};
  const factory = (opts: ConstructorParameters<typeof CopilotClient>[0]): CopilotClient => {
    const env = opts?.env as NodeJS.ProcessEnv | undefined;
    if (env !== undefined) capture.env = env;
    // Minimal CopilotClient stub. We only need `start` to throw so the
    // launch flow exits via the documented RuntimeHeadlessLaunchFailed
    // path; nothing else is called after start() rejects.
    return fakeCopilotClient({
      start: () => Promise.reject(new Error("STUB_NO_START")),
      stop: () => Promise.resolve([]),
      createSession: () => Promise.reject(new Error("should not be reached")),
    });
  };
  return { capture, factory };
}

describe("launchCopilotHeadless env merge", () => {
  it("merges subprocessEnv on top of process.env", async () => {
    const { agent, source } = await buildAgent();
    const { capture, factory } = capturingClientFactory();

    await expect(
      launchCopilotHeadless(
        {
          taskDir: workdir,
          agent,
          catalog: source,
          prompt: FRAMING,
          workspaceDir: scratch,
          subprocessEnv: {
            GLYPH_WORKSPACE: "ws-fixture-123",
            GLYPH_WORK_ID: "task-fixture-456",
          },
        },
        {
          copilotStateDir: stateDir,
          sharedDir: path.join(scratch, "shared"),
          createClient: factory,
          registerSession: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(RuntimeHeadlessLaunchFailed);

    expect(capture.env).toBeDefined();
    const env = capture.env as NodeJS.ProcessEnv;

    // The overrides MUST be present verbatim.
    expect(env.GLYPH_WORKSPACE).toBe("ws-fixture-123");
    expect(env.GLYPH_WORK_ID).toBe("task-fixture-456");

    // Parent env must survive — pick a key that ALWAYS exists on every
    // host the test suite runs on. PATH is universal; PWD/HOME/USERPROFILE
    // are platform-specific. Any of these being absent would mean the
    // subprocess inherited an empty env, which is exactly the regression
    // this test is here to catch.
    expect(env.PATH ?? env.Path ?? env.path).toBeDefined();
  });

  it("honours undefined overrides as 'delete the key from parent env'", async () => {
    const { agent, source } = await buildAgent();

    // Seed a real env var in the parent process so we can assert it
    // gets stripped by the override.
    const sentinelKey = "GLYPH_TEST_SENTINEL_TO_DELETE";
    process.env[sentinelKey] = "should-be-stripped";
    try {
      const { capture, factory } = capturingClientFactory();

      await expect(
        launchCopilotHeadless(
          {
            taskDir: workdir,
            agent,
            catalog: source,
            prompt: FRAMING,
            workspaceDir: scratch,
            subprocessEnv: {
              [sentinelKey]: undefined,
            },
          },
          {
            copilotStateDir: stateDir,
            sharedDir: path.join(scratch, "shared"),
            createClient: factory,
            registerSession: () => {},
          },
        ),
      ).rejects.toBeInstanceOf(RuntimeHeadlessLaunchFailed);

      const env = capture.env as NodeJS.ProcessEnv;
      // Sentinel key was in process.env when we made the call. The
      // override mapped it to `undefined`, which MUST be interpreted as
      // "delete it from the merged env" rather than passed through to
      // the SDK as the string "undefined".
      expect(env).toBeDefined();
      expect(sentinelKey in env).toBe(false);
    } finally {
      delete process.env[sentinelKey];
    }
  });

  it("passes the parent env through unchanged when no subprocessEnv is supplied", async () => {
    const { agent, source } = await buildAgent();
    const { capture, factory } = capturingClientFactory();

    await expect(
      launchCopilotHeadless(
        {
          taskDir: workdir,
          agent,
          catalog: source,
          prompt: FRAMING,
          workspaceDir: scratch,
        },
        {
          copilotStateDir: stateDir,
          sharedDir: path.join(scratch, "shared"),
          createClient: factory,
          registerSession: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(RuntimeHeadlessLaunchFailed);

    expect(capture.env).toBeDefined();
    const env = capture.env as NodeJS.ProcessEnv;
    expect(env.PATH ?? env.Path ?? env.path).toBeDefined();
    // It IS a copy (not the same reference) so the caller can't
    // accidentally mutate process.env via the SDK.
    expect(env).not.toBe(process.env);
  });
});

describe("launchCopilotHeadless failure handling", () => {
  it("does not register a session buffer when prompt send fails", async () => {
    const { agent, source } = await buildAgent();
    let registered = 0;
    const session = fakeCopilotSession({
      sessionId: "12345678-1234-1234-1234-1234567890ab",
      send: () => Promise.reject(new Error("STUB_SEND_FAILED")),
      disconnect: () => Promise.resolve(),
      abort: () => Promise.resolve(),
    });

    await expect(
      launchCopilotHeadless(
        {
          taskDir: workdir,
          agent,
          catalog: source,
          prompt: FRAMING,
          workspaceDir: scratch,
        },
        {
          copilotStateDir: stateDir,
          sharedDir: path.join(scratch, "shared"),
          createClient: () =>
            fakeCopilotClient({
              start: () => Promise.resolve(),
              stop: () => Promise.resolve([]),
              createSession: () => Promise.resolve(session),
            }),
          registerSession: () => {
            registered += 1;
          },
        },
      ),
    ).rejects.toBeInstanceOf(RuntimeHeadlessLaunchFailed);

    expect(registered).toBe(0);
  });

  it("rejects non-object mcpServers entries before creating the SDK session", async () => {
    const { agent, source } = await buildAgent();
    let createSessionCalled = false;
    let caught: unknown;

    try {
      await launchCopilotHeadless(
        {
          taskDir: workdir,
          agent,
          catalog: source,
          prompt: FRAMING,
          workspaceDir: scratch,
        },
        {
          copilotStateDir: stateDir,
          sharedDir: path.join(scratch, "shared"),
          createClient: () =>
            fakeCopilotClient({
              start: async () => {
                await writeFile(
                  path.join(workdir, ".mcp.json"),
                  JSON.stringify({ mcpServers: { bad: [] } }),
                  "utf8",
                );
              },
              stop: () => Promise.resolve([]),
              createSession: () => {
                createSessionCalled = true;
                return Promise.reject(new Error("should not create session"));
              },
            }),
          registerSession: () => {},
        },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeHeadlessLaunchFailed);
    expect((caught as Error).cause).toBeInstanceOf(InvalidMcpJson);
    expect(createSessionCalled).toBe(false);
  });
});
