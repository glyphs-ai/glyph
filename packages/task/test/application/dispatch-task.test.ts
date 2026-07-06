import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { DispatchTaskUseCase } from "../../src/application/dispatch-task.js";
import type { AgentResolver } from "../../src/application/ports/agent-resolver.js";
import { type TaskBrief, TaskBriefSchema } from "../../src/domain/task-brief.js";
import { buildSupervisorFixture, RESOLVED, type SupervisorFixture } from "./task-fixture.js";

let fx: SupervisorFixture;
let resolver: MockProxy<AgentResolver>;
let useCase: DispatchTaskUseCase;

beforeEach(() => {
  fx = buildSupervisorFixture();
  resolver = mock<AgentResolver>();
  resolver.getEntry.mockReturnValue(okAsync({ status: "ready" }));
  resolver.resolve.mockReturnValue(okAsync(RESOLVED));
  useCase = new DispatchTaskUseCase({
    supervisor: fx.supervisor,
    agentResolver: resolver,
    runtimeRegistry: fx.registry,
    now: fx.now,
    randomBytes: () => Buffer.from([0x00, 0x00, 0x00, 0x01]),
  });
});

afterEach(() => {
  fx.cleanup();
});

describe("DispatchTaskUseCase — validation", () => {
  it("rejects an empty agent with ZodError", () => {
    expect(() => useCase.execute({ agent: "", brief: TaskBriefSchema.parse("b") })).toThrow(
      ZodError,
    );
  });

  it("rejects an unknown key (strict)", () => {
    expect(() =>
      useCase.execute({ agent: "a", brief: "b" as TaskBrief, oops: 1 } as Parameters<
        typeof useCase.execute
      >[0]),
    ).toThrow(ZodError);
  });
});

describe("DispatchTaskUseCase — happy path", () => {
  it("resolves, dispatches, and returns a running task DTO", async () => {
    const res = (
      await useCase.execute({ agent: "public/demo", brief: TaskBriefSchema.parse("do it") })
    )._unsafeUnwrap();
    expect(res.status).toBe("running");
    expect(res.id).toBe("20260508-00000001");
    expect(res.agent).toBe("public/demo");
  });
});

describe("DispatchTaskUseCase — pre-flight error channel", () => {
  it("refuses while the supervisor is shutting down", async () => {
    await fx.supervisor.shutdown();
    const e = (
      await useCase.execute({ agent: "public/demo", brief: TaskBriefSchema.parse("b") })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("ManagerShuttingDown");
  });

  it("rejects an unsafe (multi-line) framing prompt before touching the agent", () => {
    expect(() =>
      useCase.execute({
        agent: "public/demo",
        brief: TaskBriefSchema.parse("b"),
        prompt: "line1\nline2",
      }),
    ).toThrow(ZodError);
    expect(resolver.getEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["a CR", "line1\rline2"],
    ["a non-ASCII char", "réad TASK.md"],
    ["a control char", "tab\there"],
  ])("rejects a framing prompt with %s", (_label, prompt) => {
    expect(() =>
      useCase.execute({ agent: "public/demo", brief: TaskBriefSchema.parse("b"), prompt }),
    ).toThrow(ZodError);
  });

  it("rejects a caller env key that collides with a kernel key", async () => {
    const e = (
      await useCase.execute({
        agent: "public/demo",
        brief: TaskBriefSchema.parse("b"),
        subprocessEnv: { GLYPH_WORKSPACE: "x" },
      })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("DispatchKernelEnvCollision");
  });

  it("maps an absent agent to AgentNotFound", async () => {
    resolver.getEntry.mockReturnValue(okAsync(null));
    const e = (
      await useCase.execute({ agent: "ghost", brief: TaskBriefSchema.parse("b") })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("AgentNotFound");
  });

  it("maps a blocked agent to EntryNotReady", async () => {
    resolver.getEntry.mockReturnValue(
      okAsync({ status: "blocked", blockedReason: { disabledByUser: true } }),
    );
    const e = (
      await useCase.execute({ agent: "public/demo", brief: TaskBriefSchema.parse("b") })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("EntryNotReady");
  });

  it("propagates a catalog fault as AgentUnresolvable", async () => {
    resolver.resolve.mockReturnValue(
      errAsync({ type: "AgentUnresolvable", agent: "public/demo", cause: null }),
    );
    const e = (
      await useCase.execute({ agent: "public/demo", brief: TaskBriefSchema.parse("b") })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("AgentUnresolvable");
  });

  it("maps an unregistered runtime to RuntimeDoesNotSupportTasks", async () => {
    const e = (
      await useCase.execute({
        agent: "public/demo",
        brief: TaskBriefSchema.parse("b"),
        runtime: "ghost",
      })
    )._unsafeUnwrapErr();
    expect(e.type).toBe("RuntimeDoesNotSupportTasks");
  });
});
