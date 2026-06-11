import { describe, expect, it } from "vitest";
import { spawnTerminalWith } from "../src/dispatch.js";
import { type LaunchCommand, UnsupportedPlatformError } from "../src/index.js";
import { makeDeps, sample } from "./_helpers.js";

describe("spawnTerminalWith — dispatch + validation", () => {
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
