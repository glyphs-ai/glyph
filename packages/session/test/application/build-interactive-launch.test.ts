import type { LaunchCommand, Runtime, RuntimeRegistry } from "@glyphs-ai/runtime-v2";
import { errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { BuildInteractiveLaunchUseCase } from "../../src/application/build-interactive-launch.js";
import { type LaunchMode, SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { SessionRepository } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");
const WORKDIR = `/ws/sessions/${ID}`;

const launch: LaunchCommand = {
  cmd: "copilot",
  args: ["--session-id=rsid-1"],
  cwd: WORKDIR,
  display: `cd "${WORKDIR}" && copilot --session-id=rsid-1`,
  env: { RUNTIME_VAR: "x" },
};

function entity(lastLaunchMode: LaunchMode | null): SessionEntity {
  return new SessionEntity({
    id: ID,
    agent: "public/demo",
    runtime: "copilot",
    createdAt: "2026-05-08T01:05:00.000Z",
    runtimeSessionId: "rsid-1",
    lastLaunchMode,
  });
}

let repo: MockProxy<SessionRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime>;
let sandbox: MockProxy<SessionSandbox>;
let useCase: BuildInteractiveLaunchUseCase;

beforeEach(() => {
  repo = mock<SessionRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  sandbox = mock<SessionSandbox>();
  sandbox.resolve.mockReturnValue(WORKDIR);
  runtimeRegistry.get.mockReturnValue(ok(runtime));
  runtime.buildInteractiveLaunch.mockReturnValue(okAsync(launch));
  repo.save.mockReturnValue(okAsync(undefined));
  useCase = new BuildInteractiveLaunchUseCase({
    repo,
    runtimeRegistry,
    sandbox,
    workspaceId: "ws-1",
    workspaceDir: "/ws",
  });
});

describe("BuildInteractiveLaunchUseCase", () => {
  it("layers the per-session work-context env over the runtime env", async () => {
    repo.get.mockReturnValue(okAsync(entity(null)));
    const cmd = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(cmd.cmd).toBe("copilot");
    expect(cmd.display).toBe(launch.display);
    expect(cmd.env).toEqual({
      RUNTIME_VAR: "x",
      GLYPH_WORKSPACE: "ws-1",
      GLYPH_WORKSPACE_DIR: "/ws",
      GLYPH_WORK_KIND: "session",
      GLYPH_WORK_ID: ID,
      GLYPH_WORK_DIR: WORKDIR,
    });
  });

  it("persists the launch mode the first time it changes", async () => {
    const e = entity(null);
    repo.get.mockReturnValue(okAsync(e));
    await useCase.execute({ id: ID });
    expect(e.lastLaunchMode).toBe("local");
    expect(repo.save).toHaveBeenCalledWith(e);
  });

  it("does not save when the desired mode already matches", async () => {
    repo.get.mockReturnValue(okAsync(entity("local")));
    await useCase.execute({ id: ID });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("forwards remote: true and records the remote launch mode", async () => {
    const e = entity(null);
    repo.get.mockReturnValue(okAsync(e));
    await useCase.execute({ id: ID, remote: true });
    expect(runtime.buildInteractiveLaunch).toHaveBeenCalledWith(
      "rsid-1",
      expect.objectContaining({ remote: true }),
    );
    expect(e.lastLaunchMode).toBe("remote");
  });

  it("propagates SessionNotFound without touching the runtime", async () => {
    repo.get.mockReturnValue(errAsync({ type: "SessionNotFound", id: ID }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("SessionNotFound");
    expect(runtime.buildInteractiveLaunch).not.toHaveBeenCalled();
  });
});
