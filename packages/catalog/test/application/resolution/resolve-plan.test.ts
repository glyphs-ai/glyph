import { errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import type {
  ResolvedGraph,
  ResolvedNode,
} from "../../../src/application/resolution/dependency-graph.js";
import type { GetTreeUseCase } from "../../../src/application/resolution/get-tree.js";
import type { GetUpstreamTreeUseCase } from "../../../src/application/resolution/get-upstream-tree.js";
import { ResolvePlanUseCase } from "../../../src/application/resolution/resolve-plan.js";
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
const EMPTY_DEPS = { skills: [], mcps: [], agents: [] };

function node(
  kind: "skill" | "agent" | "mcp",
  origin: string,
  fqn: string,
  opts: {
    version?: string;
    content?: string;
    skills?: string[];
    mcps?: string[];
    agents?: string[];
  } = {},
): ResolvedNode {
  return {
    kind,
    origin,
    fqn,
    version: kind === "mcp" ? "" : (opts.version ?? "1.0.0"),
    content: kind === "mcp" ? (opts.content ?? "spec") : "",
    dependencyRefs: {
      skills: opts.skills ?? [],
      mcps: opts.mcps ?? [],
      agents: opts.agents ?? [],
    },
  };
}

function graph(nodes: ResolvedNode[], conflicts: ResolvedGraph["conflicts"] = []): ResolvedGraph {
  return { nodes, conflicts };
}

function skillEntity(
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

function agentEntity(fqn: string, origin: string): AgentEntity {
  return new AgentEntity({
    fqn: fqn as AgentFqn,
    origin,
    description: `${fqn} agent`,
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: EMPTY_DEPS,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

function mcpEntity(fqn: string, origin: string, spec = "spec"): McpEntity {
  return new McpEntity({
    fqn: fqn as McpFqn,
    origin,
    spec,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

let getUpstreamTree: MockProxy<GetUpstreamTreeUseCase>;
let getTree: MockProxy<GetTreeUseCase>;
let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let mcpRepo: MockProxy<McpRepository>;
let useCase: ResolvePlanUseCase;

beforeEach(() => {
  getUpstreamTree = mock<GetUpstreamTreeUseCase>();
  getTree = mock<GetTreeUseCase>();
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  mcpRepo = mock<McpRepository>();
  getTree.execute.mockResolvedValue(ok(graph([])));
  skillRepo.get.mockImplementation((fqn) => errAsync({ type: "SkillNotFound", fqn }));
  agentRepo.get.mockImplementation((fqn) => errAsync({ type: "AgentNotFound", fqn }));
  mcpRepo.get.mockImplementation((fqn) => errAsync({ type: "McpNotFound", fqn }));
  skillRepo.list.mockReturnValue(okAsync([]));
  agentRepo.list.mockReturnValue(okAsync([]));
  mcpRepo.list.mockReturnValue(okAsync([]));
  useCase = new ResolvePlanUseCase({
    getUpstreamTree,
    getTree,
    repos: { skill: skillRepo, agent: agentRepo, mcp: mcpRepo },
  });
});

describe("ResolvePlanUseCase — diffing", () => {
  it("marks a fresh upstream closure as new", async () => {
    getUpstreamTree.execute.mockResolvedValue(
      ok(
        graph([
          node("mcp", "file:/mcp/azure", "azure/mcp"),
          node("skill", "file:/skill/root", "public/root", { mcps: ["file:/mcp/azure"] }),
        ]),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.toInstall.map((n) => [n.fqn, n.disposition, n.wasAlreadyInstalled])).toEqual([
      ["azure/mcp", "new", false],
      ["public/root", "new", false],
    ]);
    expect(plan.toInstall.find((n) => n.fqn === "public/root")?.deps).toEqual(["file:/mcp/azure"]);
    expect(plan.alreadyInstalled).toEqual([]);
    expect(plan.upToDate).toBe(false);
  });

  it("marks an unchanged installed closure up-to-date", async () => {
    const upstream = graph([node("skill", "file:/skill/root", "public/root")]);
    getUpstreamTree.execute.mockResolvedValue(ok(upstream));
    getTree.execute.mockResolvedValue(ok(upstream));

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadyInstalled).toEqual([
      expect.objectContaining({ fqn: "public/root", disposition: "up-to-date" }),
    ]);
    expect(plan.upToDate).toBe(true);
  });

  it("promotes an unchanged root to will-sync when a dependency changed", async () => {
    getUpstreamTree.execute.mockResolvedValue(
      ok(
        graph([
          node("skill", "file:/skill/child", "public/child", { version: "2.0.0" }),
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
        ]),
      ),
    );
    getTree.execute.mockResolvedValue(
      ok(
        graph([
          node("skill", "file:/skill/child", "public/child", { version: "1.0.0" }),
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
        ]),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.toInstall.map((n) => [n.fqn, n.disposition, n.wasAlreadyInstalled])).toEqual([
      ["public/child", "will-sync", true],
      ["public/root", "will-sync", true],
    ]);
  });

  it("flags local skill and mcp dependencies dropped by upstream as orphans", async () => {
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("skill", "file:/skill/root", "public/root", { version: "2.0.0" })])),
    );
    getTree.execute.mockResolvedValue(
      ok(
        graph([
          node("skill", "file:/skill/root", "public/root", {
            version: "1.0.0",
            skills: ["file:/skill/child"],
            mcps: ["file:/mcp/azure"],
          }),
          node("skill", "file:/skill/child", "public/child"),
          node("mcp", "file:/mcp/azure", "azure/mcp"),
        ]),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.orphans).toEqual([
      { kind: "skill", fqn: "public/child", origin: "file:/skill/child" },
      { kind: "mcp", fqn: "azure/mcp", origin: "file:/mcp/azure" },
    ]);
  });

  it("does not orphan a dropped dependency still referenced by another installed entry", async () => {
    const child = skillEntity("public/child", "file:/skill/child");
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("skill", "file:/skill/root", "public/root")])),
    );
    getTree.execute.mockResolvedValue(
      ok(
        graph([
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
          node("skill", "file:/skill/child", "public/child"),
        ]),
      ),
    );
    skillRepo.list.mockReturnValue(
      okAsync([skillEntity("public/other", "file:/skill/other", { skills: ["public/child"] })]),
    );
    skillRepo.get.mockImplementation((fqn) => {
      if (fqn === child.fqn) return okAsync(child);
      return errAsync({ type: "SkillNotFound", fqn });
    });

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.orphans).toEqual([]);
  });

  it("short-circuits a root identity change", async () => {
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("skill", "file:/skill/entry", "public/new-name", { version: "2.0.0" })])),
    );
    getTree.execute.mockResolvedValue(
      ok(graph([node("skill", "file:/skill/entry", "public/old-name", { version: "1.0.0" })])),
    );

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/entry" })
    )._unsafeUnwrap();

    expect(plan.identityChange).toEqual({
      kind: "skill",
      oldFqn: "public/old-name",
      newFqn: "public/new-name",
    });
    expect(plan.toInstall).toEqual([
      expect.objectContaining({ fqn: "public/new-name", disposition: "identity-changed" }),
    ]);
    expect(plan.orphans).toEqual([]);
  });
});

describe("ResolvePlanUseCase — orchestration", () => {
  it("resolves the root origin from an installed fqn before fetching upstream", async () => {
    const installed = skillEntity("public/root", "file:/skill/root", { version: "1.0.0" });
    skillRepo.get.mockImplementation((fqn) => {
      if (fqn === installed.fqn) return okAsync(installed);
      return errAsync({ type: "SkillNotFound", fqn });
    });
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("skill", installed.origin, installed.fqn)])),
    );
    getTree.execute.mockResolvedValue(ok(graph([node("skill", installed.origin, installed.fqn)])));

    const plan = (await useCase.execute({ kind: "skill", fqn: installed.fqn }))._unsafeUnwrap();

    expect(getUpstreamTree.execute).toHaveBeenCalledWith({
      kind: "skill",
      origin: installed.origin,
    });
    expect(plan.rootOrigin).toBe(installed.origin);
  });

  it("returns NotFound for an invalid sync fqn", async () => {
    const res = await useCase.execute({ kind: "skill", fqn: "not-a-fqn" });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: "not-a-fqn" });
    expect(getUpstreamTree.execute).not.toHaveBeenCalled();
  });

  it("flags upstream fqn collisions with a different installed origin", async () => {
    const existing = mcpEntity("azure/mcp", "file:/mcp/existing");
    mcpRepo.get.mockImplementation((fqn) => {
      if (fqn === existing.fqn) return okAsync(existing);
      return errAsync({ type: "McpNotFound", fqn });
    });
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("mcp", "file:/mcp/new", "azure/mcp")])),
    );

    const plan = (await useCase.execute({ kind: "mcp", origin: "file:/mcp/new" }))._unsafeUnwrap();

    expect(plan.toInstall).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        kind: "mcp",
        origin: "file:/mcp/new",
        fqn: "azure/mcp",
        reason: { kind: "origin-conflict", existingOrigin: "file:/mcp/existing" },
      },
    ]);
    expect(plan.upToDate).toBe(false);
  });

  it("propagates upstream conflicts into the plan", async () => {
    getUpstreamTree.execute.mockResolvedValue(
      ok(
        graph(
          [node("skill", "file:/skill/root", "public/root")],
          [
            {
              kind: "skill",
              origin: "file:/skill/missing",
              fqn: null,
              reason: { kind: "fetch-failed", cause: new Error("missing") },
            },
          ],
        ),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.upToDate).toBe(false);
  });

  it("keeps agent entities out of orphan reporting", async () => {
    const installedAgent = agentEntity("public/helper", "file:/agent/helper");
    agentRepo.list.mockReturnValue(okAsync([installedAgent]));
    getUpstreamTree.execute.mockResolvedValue(
      ok(graph([node("agent", "file:/agent/root", "public/root")])),
    );
    getTree.execute.mockResolvedValue(
      ok(
        graph([
          node("agent", "file:/agent/root", "public/root", { agents: ["file:/agent/helper"] }),
          node("agent", installedAgent.origin, installedAgent.fqn),
        ]),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "agent", origin: "file:/agent/root" })
    )._unsafeUnwrap();

    expect(plan.orphans).toEqual([]);
  });
});
