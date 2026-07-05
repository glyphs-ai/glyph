import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetUpstreamTreeUseCase } from "../../../src/application/resolution/get-upstream-tree.js";
import type { AgentName, AgentScope } from "../../../src/domain/agent-fqn.js";
import { AgentManifest } from "../../../src/domain/agent-manifest.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { McpManifest } from "../../../src/domain/mcp-manifest.js";
import type { SkillName, SkillScope } from "../../../src/domain/skill-fqn.js";
import { SkillManifest } from "../../../src/domain/skill-manifest.js";
import type { Source } from "../../../src/domain/source.js";

const FILES = new Map([["README.md", Buffer.from("fixture")]]);

function skillManifest(
  name: string,
  opts: { version?: string; skills?: string[]; mcps?: string[] } = {},
): SkillManifest {
  return SkillManifest.create(
    {
      name: name as SkillName,
      scope: "public" as SkillScope,
      description: `${name} skill`,
      version: opts.version ?? "1.0.0",
      dependencies: { skills: opts.skills ?? [], mcps: opts.mcps ?? [] },
    },
    FILES,
  )._unsafeUnwrap();
}

function agentManifest(
  name: string,
  opts: { version?: string; skills?: string[]; mcps?: string[]; agents?: string[] } = {},
): AgentManifest {
  return AgentManifest.create(
    {
      name: name as AgentName,
      scope: "public" as AgentScope,
      description: `${name} agent`,
      version: opts.version ?? "1.0.0",
      dependencies: {
        skills: opts.skills ?? [],
        mcps: opts.mcps ?? [],
        agents: opts.agents ?? [],
      },
    },
    FILES,
  )._unsafeUnwrap();
}

function mcpManifest(name: string, spec = JSON.stringify({ _meta: { name } })): McpManifest {
  return McpManifest.create({ _meta: { name: name as McpFqn } }, spec)._unsafeUnwrap();
}

let skillSource: MockProxy<Source<SkillManifest>>;
let agentSource: MockProxy<Source<AgentManifest>>;
let mcpSource: MockProxy<Source<McpManifest>>;
let useCase: GetUpstreamTreeUseCase;

beforeEach(() => {
  skillSource = mock<Source<SkillManifest>>();
  agentSource = mock<Source<AgentManifest>>();
  mcpSource = mock<Source<McpManifest>>();
  skillSource.load.mockImplementation((origin) =>
    errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") }),
  );
  agentSource.load.mockImplementation((origin) =>
    errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") }),
  );
  mcpSource.load.mockImplementation((origin) =>
    errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") }),
  );
  useCase = new GetUpstreamTreeUseCase({ skill: skillSource, agent: agentSource, mcp: mcpSource });
});

describe("GetUpstreamTreeUseCase — source graph", () => {
  it("returns the deduped reachable closure from an agent root", async () => {
    agentSource.load.mockImplementation((origin) => {
      if (origin === "file:/agent/root")
        return okAsync(
          agentManifest("root", {
            skills: ["file:/skill/child"],
            mcps: ["file:/mcp/shared"],
            agents: ["file:/agent/helper"],
          }),
        );
      if (origin === "file:/agent/helper")
        return okAsync(agentManifest("helper", { skills: ["file:/skill/child"] }));
      return errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") });
    });
    skillSource.load.mockImplementation((origin) => {
      if (origin === "file:/skill/child")
        return okAsync(skillManifest("child", { mcps: ["file:/mcp/shared"] }));
      return errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") });
    });
    mcpSource.load.mockImplementation((origin) => {
      if (origin === "file:/mcp/shared") return okAsync(mcpManifest("azure/mcp"));
      return errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") });
    });

    const graph = (
      await useCase.execute({ kind: "agent", origin: "file:/agent/root" })
    )._unsafeUnwrap();

    expect(graph.nodes.map((n) => n.fqn).sort()).toEqual([
      "azure/mcp",
      "public/child",
      "public/helper",
      "public/root",
    ]);
    expect(graph.conflicts).toEqual([]);
    expect(mcpSource.load).toHaveBeenCalledTimes(1);
  });

  it("records a fetch conflict for an unfetchable dependency origin", async () => {
    skillSource.load.mockImplementation((origin) => {
      if (origin === "file:/skill/root")
        return okAsync(skillManifest("root", { skills: ["file:/skill/missing"] }));
      return errAsync({ type: "SourceUnavailable", origin, cause: new Error("ENOENT") });
    });

    const graph = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(graph.nodes.map((n) => n.fqn)).toEqual(["public/root"]);
    expect(graph.conflicts).toEqual([
      expect.objectContaining({
        kind: "skill",
        origin: "file:/skill/missing",
        fqn: null,
        reason: expect.objectContaining({ kind: "fetch-failed" }),
      }),
    ]);
  });

  it("records a parse conflict for an invalid manifest", async () => {
    skillSource.load.mockReturnValue(
      errAsync({ type: "ManifestInvalid", origin: "file:/skill/root", reason: "bad yaml" }),
    );

    const graph = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(graph.nodes).toEqual([]);
    expect(graph.conflicts[0]?.reason.kind).toBe("parse-failed");
  });

  it("handles a dependency cycle by deduplicating (both nodes fetched, no conflict)", async () => {
    skillSource.load.mockImplementation((origin) => {
      if (origin === "file:/skill/a")
        return okAsync(skillManifest("a", { skills: ["file:/skill/b"] }));
      if (origin === "file:/skill/b")
        return okAsync(skillManifest("b", { skills: ["file:/skill/a"] }));
      return errAsync({ type: "SourceUnavailable", origin, cause: new Error("missing") });
    });

    const graph = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/a" })
    )._unsafeUnwrap();

    // BFS dedup: both nodes are fetched exactly once; the back-edge is
    // silently skipped because the target is already in `seen`. No conflict.
    expect(graph.nodes.map((n) => n.fqn).sort()).toEqual(["public/a", "public/b"]);
    expect(graph.conflicts).toEqual([]);
  });
});
