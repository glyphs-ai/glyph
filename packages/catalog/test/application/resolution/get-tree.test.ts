import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetTreeUseCase } from "../../../src/application/resolution/get-tree.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import type { Db } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";
import { openTestDb } from "../../testing.js";

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

let close: () => void;
let db: Db;
let skillRepo: DrizzleSkillRepository;
let agentRepo: DrizzleAgentRepository;
let mcpRepo: DrizzleMcpRepository;
let useCase: GetTreeUseCase;

beforeEach(async () => {
  const opened = await openTestDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  mcpRepo = new DrizzleMcpRepository({ db });
  useCase = new GetTreeUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
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

    (await agentRepo.save(root))._unsafeUnwrap();
    (await agentRepo.save(helper))._unsafeUnwrap();
    (await skillRepo.save(child))._unsafeUnwrap();
    (await mcpRepo.save(shared))._unsafeUnwrap();

    const graph = (await useCase.execute({ origin: root.origin }))._unsafeUnwrap();

    expect(graph.nodes.map((n) => n.fqn).sort()).toEqual([
      "azure/mcp",
      "public/child",
      "public/helper",
      "public/root",
    ]);
    expect(graph.nodes.find((n) => n.fqn === "public/root")).toEqual({
      kind: "agent",
      origin: root.origin,
      fqn: root.fqn,
      version: root.version,
      content: "",
      dependencyRefs: {
        skills: [child.origin],
        mcps: [shared.origin],
        agents: [helper.origin],
      },
    });
    expect(graph.nodes.find((n) => n.fqn === "public/child")).toEqual({
      kind: "skill",
      origin: child.origin,
      fqn: child.fqn,
      version: child.version,
      content: "",
      dependencyRefs: { skills: [], mcps: [shared.origin], agents: [] },
    });
    expect(graph.nodes.find((n) => n.fqn === "azure/mcp")).toEqual({
      kind: "mcp",
      origin: shared.origin,
      fqn: shared.fqn,
      version: "",
      content: shared.spec,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
    });
    expect(graph.conflicts).toEqual([]);
  });

  it("preserves unresolved dependency fqns as graph refs", async () => {
    const root = skill("public/root", "file:/skill/root", { skills: ["public/missing"] });
    (await skillRepo.save(root))._unsafeUnwrap();

    const graph = (await useCase.execute({ origin: root.origin }))._unsafeUnwrap();

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        kind: "skill",
        origin: root.origin,
        fqn: "public/root",
        version: "1.0.0",
        content: "",
        dependencyRefs: { skills: ["public/missing"], mcps: [], agents: [] },
      }),
    ]);
    expect(graph.conflicts).toEqual([]);
  });
});
