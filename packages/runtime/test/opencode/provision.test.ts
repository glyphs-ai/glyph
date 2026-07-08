import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionOpencodeWorkdir, toOpencodeMcpServer } from "../../src/opencode/provision.js";
import type { AgentContentSource } from "../../src/types.js";
import { makeFakeContentSource } from "../fixtures/fake-content-source.js";

const TEST_PLACEHOLDERS = { workspaceDir: "/test/workspace", sharedDir: "/test/global" } as const;

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "rt-opencode-prov-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const targetDir = (): string => path.join(scratch, "target");

async function setup(opts: {
  agent?: { name?: string; body?: string };
  mcps?: Record<string, Record<string, unknown>>;
}): Promise<{ source: AgentContentSource; agentName: string }> {
  const agentShortName = opts.agent?.name ?? "demo-agent";
  const mcpKeys = Object.keys(opts.mcps ?? {});

  const agentBody =
    opts.agent?.body ??
    [
      "---",
      `name: ${agentShortName}`,
      "description: agent for tests",
      "version: 0.0.1",
      "---",
      "",
    ].join("\n");

  const { source } = makeFakeContentSource({
    agents: {
      [agentShortName]: {
        files: { "AGENTS.md": agentBody },
        deps: { mcps: mcpKeys },
      },
    },
    ...(opts.mcps ? { mcps: opts.mcps } : {}),
  });

  return { source, agentName: agentShortName };
}

describe("provisionOpencodeWorkdir", () => {
  it("copies AGENTS.md verbatim into workdir", async () => {
    const { source, agentName } = await setup({});
    await provisionOpencodeWorkdir(
      targetDir(),
      await source.resolveAgent(agentName),
      source,
      TEST_PLACEHOLDERS,
    );
    const content = await readFile(path.join(targetDir(), "AGENTS.md"), "utf8");
    expect(content).toContain("name: demo-agent");
  });

  it("does not write opencode.json when there are no MCPs", async () => {
    const { source, agentName } = await setup({});
    await provisionOpencodeWorkdir(
      targetDir(),
      await source.resolveAgent(agentName),
      source,
      TEST_PLACEHOLDERS,
    );
    expect(await exists(path.join(targetDir(), "opencode.json"))).toBe(false);
  });

  it("writes opencode.json with converted MCP config", async () => {
    const { source, agentName } = await setup({
      mcps: {
        "io.playwright/mcp": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@playwright/mcp@latest", "--headless"],
        },
      },
    });
    await provisionOpencodeWorkdir(
      targetDir(),
      await source.resolveAgent(agentName),
      source,
      TEST_PLACEHOLDERS,
    );
    const raw = await readFile(path.join(targetDir(), "opencode.json"), "utf8");
    const cfg = JSON.parse(raw) as { mcp: Record<string, unknown> };
    expect(cfg.mcp).toBeDefined();
    const server = cfg.mcp["io.playwright/mcp"] as Record<string, unknown>;
    expect(server.type).toBe("local");
    expect(server.command).toEqual(["npx", "-y", "@playwright/mcp@latest", "--headless"]);
  });

  it("substitutes ${workspaceDir} placeholders in MCP args", async () => {
    const { source, agentName } = await setup({
      mcps: {
        "test/mcp": {
          type: "stdio",
          command: "npx",
          args: ["--storage-state", "${workspaceDir}/.playwright/state.json"],
        },
      },
    });
    await provisionOpencodeWorkdir(
      targetDir(),
      await source.resolveAgent(agentName),
      source,
      TEST_PLACEHOLDERS,
    );
    const raw = await readFile(path.join(targetDir(), "opencode.json"), "utf8");
    const cfg = JSON.parse(raw) as { mcp: Record<string, Record<string, unknown>> };
    const server = cfg.mcp["test/mcp"];
    if (!server) throw new Error("test/mcp entry missing from opencode.json");
    expect((server.command as string[]).join(" ")).toContain("/test/workspace");
    expect((server.command as string[]).join(" ")).not.toContain("${workspaceDir}");
  });

  it("wraps provision failures when MCP config is invalid", async () => {
    const { source, agentName } = await setup({
      mcps: { "bad/mcp": { type: "stdio", command: "cmd" } },
    });
    const { setMcpConfigOverride } = makeFakeContentSource({
      agents: {
        "demo-agent": {
          files: { "AGENTS.md": "---\nname: demo-agent\nversion: 0.0.1\n---\n" },
          deps: { mcps: ["bad/mcp"] },
        },
      },
      mcps: { "bad/mcp": { type: "stdio", command: "cmd" } },
    });
    setMcpConfigOverride("bad/mcp", new Error("catalog read failed"));
    const freshSource = makeFakeContentSource({
      agents: {
        "demo-agent": {
          files: { "AGENTS.md": "---\nname: demo-agent\nversion: 0.0.1\n---\n" },
          deps: { mcps: ["bad/mcp"] },
        },
      },
    });
    freshSource.setMcpConfigOverride("bad/mcp", new Error("catalog read failed"));
    await expect(
      provisionOpencodeWorkdir(
        targetDir(),
        await freshSource.source.resolveAgent("demo-agent"),
        freshSource.source,
        TEST_PLACEHOLDERS,
      ),
    ).rejects.toThrow("catalog read failed");
  });
});

describe("toOpencodeMcpServer", () => {
  it("converts stdio type to local", () => {
    const result = toOpencodeMcpServer({
      type: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: { KEY: "VALUE" },
    });
    expect(result.type).toBe("local");
    expect(result.command).toEqual(["npx", "-y", "some-mcp"]);
    expect((result as { environment: Record<string, string> }).environment).toEqual({
      KEY: "VALUE",
    });
  });

  it("omits environment when env is empty", () => {
    const result = toOpencodeMcpServer({ type: "stdio", command: "cmd", args: [] });
    expect(Object.prototype.hasOwnProperty.call(result, "environment")).toBe(false);
  });

  it("passes non-stdio types through unchanged", () => {
    const input = { type: "remote", url: "https://example.com/mcp" };
    expect(toOpencodeMcpServer(input)).toEqual(input);
  });

  it("handles missing args gracefully", () => {
    const result = toOpencodeMcpServer({ type: "stdio", command: "cmd" });
    expect(result.command).toEqual(["cmd"]);
  });
});
