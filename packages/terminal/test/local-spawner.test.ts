import { describe, expect, it } from "vitest";
import { UnsupportedPlatformError } from "../src/_errors.js";
import type { LaunchCommand } from "../src/index.js";
import { spawnerWith, spawnTerminalWith } from "../src/local-spawner.js";
import { makeDeps, sample } from "./_helpers.js";

/**
 * Tests for `local-spawner.ts`. Two layers:
 *
 *   1. `spawnTerminalWith` — the package-private dispatch core. It
 *      validates the command and routes to a platform launcher, throwing
 *      on a bad command or an unsupported platform. (Per-platform launch
 *      detail lives in the `platforms/*.test.ts` specs.)
 *   2. `localSpawner` / `spawnerWith` — the public `Spawner` boundary,
 *      which catches every internal throw and surfaces it as a
 *      `SpawnFailed` whose `code` is the originating error class's name.
 */
describe("spawnTerminalWith — validation guards (throws)", () => {
  it("rejects cwd containing a control character", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const bad: LaunchCommand = { ...sample, cwd: "/tmp/wd\nrm -rf" };
    await expect(spawnTerminalWith(bad, deps)).rejects.toThrow(/control character/);
  });

  it("rejects argument containing a control character", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const bad: LaunchCommand = { ...sample, args: ["-i\x00malicious"] };
    await expect(spawnTerminalWith(bad, deps)).rejects.toThrow(/control character/);
  });

  it("rejects command containing a control character", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const bad: LaunchCommand = { ...sample, cmd: "copilot\x07" };
    await expect(spawnTerminalWith(bad, deps)).rejects.toThrow(/control character/);
  });

  it("rejects environment names that are not portable shell identifiers", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const bad: LaunchCommand = { ...sample, env: { "BAD;echo": "x" } };
    await expect(spawnTerminalWith(bad, deps)).rejects.toThrow(/environment variable name/);
  });

  it("throws UnsupportedPlatformError on unknown platform", async () => {
    const { deps } = makeDeps({ platform: "freebsd" as NodeJS.Platform });
    await expect(spawnTerminalWith(sample, deps)).rejects.toThrow(UnsupportedPlatformError);
  });
});

/**
 * Platform-selection detail is covered by the `platforms/*.test.ts`
 * specs against `spawnTerminalWith`; here we pin only the throw → Result
 * translation that makes terminal speak neverthrow.
 */
describe("localSpawner — throw caught at the Spawner boundary → SpawnFailed", () => {
  it("maps a successful launch to ok({ launcher })", async () => {
    const { deps } = makeDeps({ platform: "darwin" });
    const res = await spawnerWith(deps).spawn(sample);
    expect(res._unsafeUnwrap()).toEqual({ launcher: "Terminal" });
  });

  it("maps NoTerminalFoundError → SpawnFailed{ code: 'NoTerminalFoundError' }", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const err = (await spawnerWith(deps).spawn(sample))._unsafeUnwrapErr();
    expect(err.type).toBe("SpawnFailed");
    expect(err.code).toBe("NoTerminalFoundError");
  });

  it("maps UnsupportedPlatformError → SpawnFailed{ code: 'UnsupportedPlatformError' }", async () => {
    const { deps } = makeDeps({ platform: "aix" });
    const err = (await spawnerWith(deps).spawn(sample))._unsafeUnwrapErr();
    expect(err.code).toBe("UnsupportedPlatformError");
  });

  it("maps InvalidLaunchCommandError (control char in cwd) → code 'InvalidLaunchCommandError'", async () => {
    const { deps } = makeDeps({ platform: "linux" });
    const err = (
      await spawnerWith(deps).spawn({ ...sample, cwd: "/tmp/\u0001" })
    )._unsafeUnwrapErr();
    expect(err.code).toBe("InvalidLaunchCommandError");
  });

  it("maps a fast child failure → SpawnFailed{ code: 'TerminalSpawnFailedError' }", async () => {
    const { deps } = makeDeps({ platform: "darwin", failures: { 0: "ENOENT" } });
    const err = (await spawnerWith(deps).spawn(sample))._unsafeUnwrapErr();
    expect(err.code).toBe("TerminalSpawnFailedError");
  });
});
