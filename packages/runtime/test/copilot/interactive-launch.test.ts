import { describe, expect, it } from "vitest";
import { buildCopilotLaunchCommand } from "../../src/copilot/interactive-launch.js";

describe("buildCopilotLaunchCommand", () => {
  it("with no runtimeSessionId returns `copilot --yolo`", () => {
    const c = buildCopilotLaunchCommand(null, { workdir: "/tmp/work-1" });
    expect(c.cmd).toBe("copilot");
    expect(c.args).toEqual(["--yolo"]);
    expect(c.cwd).toBe("/tmp/work-1");
    expect(c.display).toBe(`cd "/tmp/work-1" && copilot --yolo`);
  });

  it("with runtimeSessionId uses --session-id=<id> form plus --yolo", () => {
    const sid = "12345678-1234-1234-1234-1234567890ab";
    const c = buildCopilotLaunchCommand(sid, { workdir: "/tmp/work-1" });
    expect(c.cmd).toBe("copilot");
    expect(c.args).toEqual([`--session-id=${sid}`, "--yolo"]);
    expect(c.cwd).toBe("/tmp/work-1");
    expect(c.display).toBe(`cd "/tmp/work-1" && copilot --session-id=${sid} --yolo`);
  });

  it("never passes the bare `-i` flag (which actually requires a prompt arg)", () => {
    expect(buildCopilotLaunchCommand(null, { workdir: "/x" }).args).not.toContain("-i");
    expect(
      buildCopilotLaunchCommand("12345678-1234-1234-1234-1234567890ab", { workdir: "/x" }).args,
    ).not.toContain("-i");
  });

  it("uses the equals form for --session-id (not the space-separated form)", () => {
    const sid = "11111111-2222-3333-4444-555555555555";
    const args = buildCopilotLaunchCommand(sid, { workdir: "/x" }).args;
    expect(args).toEqual([`--session-id=${sid}`, "--yolo"]);
    expect(args).not.toContain("--session-id");
  });

  it("always appends --yolo to skip per-action confirmation prompts", () => {
    expect(buildCopilotLaunchCommand(null, { workdir: "/x" }).args).toContain("--yolo");
    expect(
      buildCopilotLaunchCommand("12345678-1234-1234-1234-1234567890ab", { workdir: "/x" }).args,
    ).toContain("--yolo");
  });

  it("escapes embedded quotes in cwd display", () => {
    const c = buildCopilotLaunchCommand(null, { workdir: `/tmp/has "quote"` });
    expect(c.display).toContain(`"/tmp/has \\"quote\\""`);
  });
});
