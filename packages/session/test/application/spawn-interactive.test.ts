import type { LaunchCommand } from "@glyphs-ai/runtime";
import type { Spawner } from "@glyphs-ai/terminal";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import type { BuildInteractiveLaunchUseCase } from "../../src/application/build-interactive-launch.js";
import { SpawnInteractiveUseCase } from "../../src/application/spawn-interactive.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");

const launch: LaunchCommand = {
  cmd: "copilot",
  args: ["--session-id=rsid-1"],
  cwd: "/ws/sessions/20260508-9dfbdf05",
  display: 'cd "/ws/sessions/20260508-9dfbdf05" && copilot --session-id=rsid-1',
};

let build: MockProxy<BuildInteractiveLaunchUseCase>;
let spawner: MockProxy<Spawner>;
let useCase: SpawnInteractiveUseCase;

beforeEach(() => {
  build = mock<BuildInteractiveLaunchUseCase>();
  spawner = mock<Spawner>();
  build.execute.mockReturnValue(okAsync(launch));
  spawner.spawn.mockReturnValue(okAsync({ launcher: "wt" }));
  useCase = new SpawnInteractiveUseCase({ buildInteractiveLaunch: build, spawner });
});

describe("SpawnInteractiveUseCase", () => {
  it("returns ok:true with the launcher + display on a successful spawn", async () => {
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res).toEqual({ ok: true, launcher: "wt", display: launch.display });
  });

  it("folds a spawn failure into ok:false, preserving the copy-paste display", async () => {
    spawner.spawn.mockReturnValue(
      errAsync({
        type: "SpawnFailed",
        message: "ENOENT: terminal not found",
        code: "NoTerminalFoundError",
      }),
    );
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res).toEqual({
      ok: false,
      error: "ENOENT: terminal not found",
      code: "NoTerminalFoundError",
      display: launch.display,
    });
  });

  it("folds a build failure into ok:false with an empty display", async () => {
    build.execute.mockReturnValue(errAsync({ type: "SessionNotFound", id: ID }));
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res).toEqual({
      ok: false,
      error: `session not found: ${ID}`,
      code: "SessionNotFound",
      display: "",
    });
  });
});
