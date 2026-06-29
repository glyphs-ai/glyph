import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTreeUseCase } from "../../../src/application/resolution/get-tree.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const NOW = "2026-01-01T00:00:00.000Z";

function skill(
  fqn: string,
  origin: string,
  opts: { version?: string; skills?: string[]; mcps?: string[] } = {},
): SkillEntity {
  return new SkillEntity({
    fqn: fqn as SkillFqn,
    origin,
    description: `${fqn} skill`,
    version: opts.version ?? "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: opts.skills ?? [], mcps: opts.mcps ?? [] },
    installedAt: NOW,
    updatedAt: NOW,
  });
}

function agent(
  fqn: string,
  origin: string,
  opts: { version?: string; skills?: string[]; mcps?: string[]; agents?: string[] } = {},
): AgentEntity {
  return new AgentEntity({
    fqn: fqn as AgentFqn,
    origin,
    description: `${fqn} agent`,
    version: opts.version ?? "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: {
      skills: opts.skills ?? [],
      mcps: opts.mcps ?? [],
      agents: opts.agents ?? [],
    },
    installedAt: NOW,
    updatedAt: NOW,
  });
}

function mcp(
  fqn: string,
  origin: string,
  spec = JSON.stringify({ _meta: { name: fqn } }),
): McpEntity {
  return new McpEntity({
    fqn: fqn as McpFqn,
    origin,
    spec,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let mcpRepo: MockProxy<McpRepository>;
let useCase: GetTreeUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  mcpRepo = mock<McpRepository>();
  skillRepo.findByOrigin.mockImplementation(() => okAsync(undefined));
  agentRepo.findByOrigin.mockImplementation(() => okAsync(undefined));
  mcpRepo.findByOrigin.mockImplementation(() => okAsync(undefined));
  skillRepo.findByFqn.mockImplementation(() => okAsync(undefined));
  agentRepo.findByFqn.mockImplementation(() => okAsync(undefined));
  mcpRepo.findByFqn.mockImplementation(() => okAsync(undefined));
  useCase = new GetTreeUseCase({ skill: skillRepo, agent: agentRepo, mcp: mcpRepo });
});

describe("GetTreeUseCase — installed graph", () => {
  it("returns an empty graph when the seed origin is not installed", async () => {
    const graph = (await useCase.execute({ origin: "file:/missing" }))._unsafeUnwrap();

    expect(graph).toEqual({ nodes: [], conflicts: [] });
  });

  it("walks installed dependencies and converts stored fqns back to origins", async () => {
    const root = agent("public/root", "file:/agent/root", {
      skills: ["public/child"],
      mcps: ["azure/mcp"],
      agents: ["public/helper"],
    });
    const helper = agent("public/helper", "file:/agent/helper");
    const child = skill("public/child", "file:/skill/child", { mcps: ["azure/mcp"] });
    const shared = mcp("azure/mcp", "file:/mcp/shared");

    agentRepo.findByOrigin.mockImplementation((origin) => {
      if (origin === root.origin) return okAsync(root);
      if (origin === helper.origin) return okAsync(helper);
      return okAsync(undefined);
    });
    skillRepo.findByOrigin.mockImplementation((origin) =>
      origin === child.origin ? okAsync(child) : okAsync(undefined),
    );
    mcpRepo.findByOrigin.mockImplementation((origin) =>
      origin === shared.origin ? okAsync(shared) : okAsync(undefined),
    );
    agentRepo.findByFqn.mockImplementation((fqn) =>
      fqn === helper.fqn ? okAsync(helper) : okAsync(undefined),
    );
    skillRepo.findByFqn.mockImplementation((fqn) =>
      fqn === child.fqn ? okAsync(child) : okAsync(undefined),
    );
    mcpRepo.findByFqn.mockImplementation((fqn) =>
      fqn === shared.fqn ? okAsync(shared) : okAsync(undefined),
    );

    const graph = (await useCase.execute({ origin: root.origin }))._unsafeUnwrap();

    expect(graph.nodes.map((n) => n.fqn).sort()).toEqual([
      "azure/mcp",
      "public/child",
      "public/helper",
      "public/root",
    ]);
    expect(graph.nodes.find((n) => n.fqn === "public/root")?.dependencyRefs).toEqual({
      skills: [child.origin],
      mcps: [shared.origin],
      agents: [helper.origin],
    });
    expect(graph.conflicts).toEqual([]);
    expect(mcpRepo.findByOrigin).toHaveBeenCalledWith(shared.origin);
  });

  it("preserves unresolved dependency fqns as graph refs", async () => {
    const root = skill("public/root", "file:/skill/root", { skills: ["public/missing"] });
    skillRepo.findByOrigin.mockImplementation((origin) =>
      origin === root.origin ? okAsync(root) : okAsync(undefined),
    );

    const graph = (await useCase.execute({ origin: root.origin }))._unsafeUnwrap();

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        fqn: "public/root",
        dependencyRefs: { skills: ["public/missing"], mcps: [], agents: [] },
      }),
    ]);
  });

  it("propagates DatabaseUnavailable from repository reads", async () => {
    agentRepo.findByOrigin.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("disk") }),
    );

    const res = await useCase.execute({ origin: "file:/agent/root" });

    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
