import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpencodeRuntime } from "../../src/index.js";
import type { AgentContentSource, ResolvedAgent } from "../../src/types.js";
import { makeFakeContentSource } from "../fixtures/fake-content-source.js";

let scratch: string;
let workdir: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "rt-opencode-rt-"));
  workdir = path.join(scratch, "work");
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

describe("OpencodeRuntime", () => {
  it("kind is 'opencode'", () => {
    expect(new OpencodeRuntime().kind).toBe("opencode");
  });

  describe("provision", () => {
    it("provisions the workdir and returns runtimeSessionId of null (discovery-only)", async () => {
      const rt = new OpencodeRuntime();
      const { agent, source } = await buildAgent();
      const r = (
        await rt.provision({ workdir, agent, catalog: source, workspaceDir: scratch })
      )._unsafeUnwrap();
      expect(r.runtimeSessionId).toBeNull();
    });

    it("copies AGENTS.md into workdir during provision", async () => {
      const rt = new OpencodeRuntime();
      const { agent, source } = await buildAgent();
      await rt.provision({ workdir, agent, catalog: source, workspaceDir: scratch });
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(path.join(workdir, "AGENTS.md"), "utf8");
      expect(content).toContain("# demo");
    });

    it("wraps provision failures in RuntimeProvisionFailed", async () => {
      const rt = new OpencodeRuntime();
      const { source } = await buildAgent();
      const broken: ResolvedAgent = { agent: { fqn: "public/absent" }, skills: [], mcps: [] };
      const r = await rt.provision({
        workdir,
        agent: broken,
        catalog: source,
        workspaceDir: scratch,
      });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.type).toBe("RuntimeProvisionFailed");
      }
    });
  });

  describe("buildInteractiveLaunch", () => {
    it("returns opencode --auto for a fresh session (null runtimeSessionId)", async () => {
      const rt = new OpencodeRuntime();
      const r = (
        await rt.buildInteractiveLaunch(null, { workdir, workspaceDir: scratch })
      )._unsafeUnwrap();
      expect(r.cmd).toBe("opencode");
      expect(r.args).toContain("--auto");
      expect(r.args).not.toContain("--session");
      expect(r.cwd).toBe(workdir);
    });

    it("includes --session <id> when runtimeSessionId is non-null", async () => {
      const rt = new OpencodeRuntime();
      const r = (
        await rt.buildInteractiveLaunch("ses_01abc", { workdir, workspaceDir: scratch })
      )._unsafeUnwrap();
      expect(r.args).toContain("--session");
      expect(r.args).toContain("ses_01abc");
    });

    it("returns RuntimeLaunchFailed when remote mode is requested", async () => {
      const rt = new OpencodeRuntime();
      const r = await rt.buildInteractiveLaunch(null, {
        workdir,
        workspaceDir: scratch,
        remote: true,
      });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.type).toBe("RuntimeLaunchFailed");
      }
    });

    it("layers subprocessEnvBase into the returned env", async () => {
      const rt = new OpencodeRuntime({
        subprocessEnvBase: { GLYPH_SERVER: "http://localhost:8787" },
      });
      const r = (
        await rt.buildInteractiveLaunch(null, { workdir, workspaceDir: scratch })
      )._unsafeUnwrap();
      expect(r.env).toMatchObject({ GLYPH_SERVER: "http://localhost:8787" });
    });
  });

  describe("launchHeadless", () => {
    it("returns RuntimeHeadlessLaunchFailed when the CLI is not installed", async () => {
      const rt = new OpencodeRuntime({
        headlessDeps: {
          // Inject a fake spawn that immediately emits ENOENT.
          spawnProcess: (() => {
            const { EventEmitter } = require("node:events");
            const proc = Object.assign(new EventEmitter(), {
              stdin: null,
              stdout: Object.assign(new EventEmitter(), { on: () => {}, once: () => {} }),
              stderr: Object.assign(new EventEmitter(), { on: () => {}, once: () => {} }),
              kill: () => {},
            });
            setTimeout(
              () =>
                proc.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
              0,
            );
            return proc;
          }) as unknown as typeof import("node:child_process").spawn,
        },
      });
      await mkdir(workdir, { recursive: true });
      const { agent, source } = await buildAgent();
      const r = await rt.launchHeadless({
        workdir,
        agent,
        catalog: source,
        prompt: "hello",
        workspaceDir: scratch,
      });
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.type).toBe("RuntimeHeadlessLaunchFailed");
      }
    });
  });

  describe("readMetadata", () => {
    it("returns null (not yet implemented)", async () => {
      const rt = new OpencodeRuntime();
      const r = (await rt.readMetadata("ses_01abc"))._unsafeUnwrap();
      expect(r).toBeNull();
    });
  });

  describe("deleteState", () => {
    it("succeeds without doing anything", async () => {
      const rt = new OpencodeRuntime();
      const r = await rt.deleteState("ses_01abc");
      expect(r.isOk()).toBe(true);
    });
  });
});
