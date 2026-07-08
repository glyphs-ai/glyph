import { describe, expect, it } from "vitest";
import { buildOpencodeLaunchCommand } from "../../src/opencode/interactive-launch.js";

describe("buildOpencodeLaunchCommand", () => {
  it("produces opencode --auto for a fresh session", () => {
    const cmd = buildOpencodeLaunchCommand(null, { workdir: "/my/workdir" });
    expect(cmd.cmd).toBe("opencode");
    expect(cmd.args).toEqual(["--auto"]);
    expect(cmd.cwd).toBe("/my/workdir");
  });

  it("includes --session <id> when resuming", () => {
    const cmd = buildOpencodeLaunchCommand("ses_01abc", { workdir: "/work" });
    expect(cmd.args).toEqual(["--session", "ses_01abc", "--auto"]);
  });

  it("display string contains the workdir path", () => {
    const cmd = buildOpencodeLaunchCommand(null, { workdir: "/a/b/c" });
    expect(cmd.display).toContain("/a/b/c");
    expect(cmd.display).toContain("opencode");
  });
});
