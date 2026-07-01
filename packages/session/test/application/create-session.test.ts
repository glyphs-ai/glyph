import type {
  AgentContentSource,
  ResolvedAgent,
  Runtime,
  RuntimeRegistry,
} from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { CreateSessionUseCase, generateSessionId } from "../../src/application/create-session.js";
import type { AgentResolver } from "../../src/application/ports/agent-resolver.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { SessionRepository } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";

const RESOLVED: ResolvedAgent = { agent: { fqn: "public/demo" }, skills: [], mcps: [] };
const now = () => new Date(2026, 4, 8, 1, 5);
const randomBytes = () => Buffer.from([0x9d, 0xfb, 0xdf, 0x05]);
const ID = "20260508-9dfbdf05";
const WORKDIR = `/ws/sessions/${ID}`;

let repo: MockProxy<SessionRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime>;
let sandbox: MockProxy<SessionSandbox>;
let agentResolver: MockProxy<AgentResolver>;
let contentSource: MockProxy<AgentContentSource>;
let useCase: CreateSessionUseCase;

beforeEach(() => {
  repo = mock<SessionRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  sandbox = mock<SessionSandbox>();
  agentResolver = mock<AgentResolver>();
  contentSource = mock<AgentContentSource>();
  agentResolver.resolve.mockReturnValue(okAsync(RESOLVED));
  runtimeRegistry.get.mockReturnValue(ok(runtime));
  sandbox.create.mockReturnValue(okAsync(WORKDIR));
  sandbox.remove.mockReturnValue(okAsync(undefined));
  runtime.provision.mockReturnValue(okAsync({ runtimeSessionId: "rsid-1" }));
  runtime.deleteState.mockReturnValue(okAsync(undefined));
  repo.insert.mockReturnValue(okAsync(undefined));
  useCase = new CreateSessionUseCase({
    repo,
    runtimeRegistry,
    sandbox,
    agentResolver,
    contentSource,
    workspaceDir: "/ws",
    now,
    randomBytes,
  });
});

describe("CreateSessionUseCase — input validation", () => {
  it("rejects an empty agent with ZodError", () => {
    expect(() => useCase.execute({ agent: "" })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", () => {
    expect(() =>
      useCase.execute({ agent: "public/demo", extra: 1 } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("CreateSessionUseCase — happy path", () => {
  it("resolves, provisions, persists, and projects the response", async () => {
    const res = (await useCase.execute({ agent: "public/demo" }))._unsafeUnwrap();
    expect(res).toEqual({
      id: ID,
      workdir: WORKDIR,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: "rsid-1",
      createdAt: now().toISOString(),
      lastActiveAt: null,
      preview: null,
      lastLaunchMode: null,
    });
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it("defaults the runtime kind to copilot", async () => {
    await useCase.execute({ agent: "public/demo" });
    expect(runtimeRegistry.get).toHaveBeenCalledWith("copilot");
  });

  it("forwards an explicit runtime override", async () => {
    await useCase.execute({ agent: "public/demo", runtime: "gemini" });
    expect(runtimeRegistry.get).toHaveBeenCalledWith("gemini");
  });
});

describe("CreateSessionUseCase — error channel + rollback", () => {
  it("AgentNotFound short-circuits before any sandbox is created", async () => {
    agentResolver.resolve.mockReturnValue(errAsync({ type: "AgentNotFound", agent: "ghost" }));
    const err = (await useCase.execute({ agent: "ghost" }))._unsafeUnwrapErr();
    expect(err.type).toBe("AgentNotFound");
    expect(sandbox.create).not.toHaveBeenCalled();
  });

  it("UnknownRuntime short-circuits before any sandbox is created", async () => {
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "ghost" }));
    const e = (
      await useCase.execute({ agent: "public/demo", runtime: "ghost" })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("UnknownRuntime");
    expect(sandbox.create).not.toHaveBeenCalled();
  });

  it("rolls back the sandbox when runtime.provision fails", async () => {
    runtime.provision.mockReturnValue(errAsync({ type: "RuntimeProvisionFailed", cause: null }));
    const err = (await useCase.execute({ agent: "public/demo" }))._unsafeUnwrapErr();
    expect(err.type).toBe("RuntimeProvisionFailed");
    expect(sandbox.remove).toHaveBeenCalledWith(ID);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rolls back sandbox + runtime state when insert conflicts", async () => {
    repo.insert.mockReturnValue(errAsync({ type: "SessionIdConflict", id: ID as never }));
    const err = (await useCase.execute({ agent: "public/demo" }))._unsafeUnwrapErr();
    expect(err.type).toBe("SessionIdConflict");
    expect(sandbox.remove).toHaveBeenCalledWith(ID);
    expect(runtime.deleteState).toHaveBeenCalledWith("rsid-1");
  });
});

describe("generateSessionId", () => {
  it("formats the local date prefix and 8-hex suffix from the injected seams", () => {
    const fixedNow = () => new Date(2026, 4, 8, 13, 30); // 2026-05-08 (month is 0-based)
    const fixedBytes = () => Buffer.from([0x9d, 0xfb, 0xdf, 0x05]);
    expect(generateSessionId(fixedNow, fixedBytes)).toBe("20260508-9dfbdf05");
  });

  it("zero-pads single-digit months and days", () => {
    const fixedNow = () => new Date(2026, 0, 3, 0, 0);
    const fixedBytes = () => Buffer.from([0x00, 0x0a, 0xff, 0x10]);
    expect(generateSessionId(fixedNow, fixedBytes)).toBe("20260103-000aff10");
  });

  it("produces an id that round-trips through SessionIdSchema", () => {
    const id = generateSessionId(
      () => new Date(2026, 11, 31),
      () => Buffer.from([0x12, 0x34, 0x56, 0x78]),
    );
    expect(SessionIdSchema.parse(id)).toBe(id);
  });
});
