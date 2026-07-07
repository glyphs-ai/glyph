import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResolvedGraph,
  ResolvedNode,
} from "../../../src/application/resolution/dependency-graph.js";
import type { GetTreeUseCase } from "../../../src/application/resolution/get-tree.js";
import type { GetUpstreamTreeUseCase } from "../../../src/application/resolution/get-upstream-tree.js";
import { ResolvePlanUseCase } from "../../../src/application/resolution/resolve-plan.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const NOW = "2026-01-01T00:00:00.000Z";

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

function agentEntity(
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

function mcpEntity(fqn: string, origin: string, spec = "spec"): McpEntity {
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
let getUpstreamTreeExecute: ReturnType<typeof vi.fn>;
let getTreeExecute: ReturnType<typeof vi.fn>;
let useCase: ResolvePlanUseCase;

async function saveSkill(entity: SkillEntity): Promise<void> {
  (await skillRepo.save(entity))._unsafeUnwrap();
}

async function saveAgent(entity: AgentEntity): Promise<void> {
  (await agentRepo.save(entity))._unsafeUnwrap();
}

async function saveMcp(entity: McpEntity): Promise<void> {
  (await mcpRepo.save(entity))._unsafeUnwrap();
}

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  mcpRepo = new DrizzleMcpRepository({ db });
  getUpstreamTreeExecute = vi.fn(() => okAsync(graph([])));
  getTreeExecute = vi.fn(() => okAsync(graph([])));
  useCase = new ResolvePlanUseCase({
    getUpstreamTree: { execute: getUpstreamTreeExecute } as unknown as GetUpstreamTreeUseCase,
    getTree: { execute: getTreeExecute } as unknown as GetTreeUseCase,
    queries: new DrizzleCatalogQueries({ db }),
  });
});

afterEach(() => {
  close();
});

describe("ResolvePlanUseCase — diffing", () => {
  it("marks a fresh upstream closure as new", async () => {
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(
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

  it("marks a dep as up-to-date when already installed from same origin (shared dep)", async () => {
    // skillB is already installed as a dependency of something else
    await saveSkill(skillEntity("public/child", "file:/skill/child"));

    getUpstreamTreeExecute.mockReturnValue(
      okAsync(
        graph([
          node("skill", "file:/skill/child", "public/child"),
          node("agent", "file:/agent/root", "public/root", { skills: ["file:/skill/child"] }),
        ]),
      ),
    );

    const plan = (
      await useCase.execute({ kind: "agent", origin: "file:/agent/root" })
    )._unsafeUnwrap();

    expect(plan.alreadyInstalled.map((n) => [n.fqn, n.disposition])).toEqual([
      ["public/child", "up-to-date"],
    ]);
    expect(plan.toInstall.map((n) => [n.fqn, n.disposition])).toEqual([["public/root", "new"]]);
  });

  it("marks an unchanged installed closure up-to-date", async () => {
    const upstream = graph([node("skill", "file:/skill/root", "public/root")]);
    getUpstreamTreeExecute.mockReturnValue(okAsync(upstream));
    getTreeExecute.mockReturnValue(okAsync(upstream));
    await saveSkill(skillEntity("public/root", "file:/skill/root"));

    const plan = (await useCase.execute({ kind: "skill", fqn: "public/root" }))._unsafeUnwrap();

    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadyInstalled).toEqual([
      expect.objectContaining({ fqn: "public/root", disposition: "up-to-date" }),
    ]);
    expect(plan.upToDate).toBe(true);
  });

  it("promotes an unchanged root to will-sync when a dependency changed", async () => {
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(
        graph([
          node("skill", "file:/skill/child", "public/child", { version: "2.0.0" }),
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
        ]),
      ),
    );
    getTreeExecute.mockReturnValue(
      okAsync(
        graph([
          node("skill", "file:/skill/child", "public/child", { version: "1.0.0" }),
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
        ]),
      ),
    );
    await saveSkill(skillEntity("public/root", "file:/skill/root", { skills: ["public/child"] }));
    await saveSkill(skillEntity("public/child", "file:/skill/child"));

    const plan = (await useCase.execute({ kind: "skill", fqn: "public/root" }))._unsafeUnwrap();

    expect(plan.toInstall.map((n) => [n.fqn, n.disposition, n.wasAlreadyInstalled])).toEqual([
      ["public/child", "will-sync", true],
      ["public/root", "will-sync", true],
    ]);
  });

  it("flags local skill and mcp dependencies dropped by upstream as orphans", async () => {
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", "file:/skill/root", "public/root", { version: "2.0.0" })])),
    );
    getTreeExecute.mockReturnValue(
      okAsync(
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
    await saveSkill(
      skillEntity("public/root", "file:/skill/root", {
        version: "1.0.0",
        skills: ["public/child"],
        mcps: ["azure/mcp"],
      }),
    );
    await saveSkill(skillEntity("public/child", "file:/skill/child"));
    await saveMcp(mcpEntity("azure/mcp", "file:/mcp/azure"));

    const plan = (await useCase.execute({ kind: "skill", fqn: "public/root" }))._unsafeUnwrap();

    expect(plan.orphans).toEqual([
      { kind: "skill", fqn: "public/child", origin: "file:/skill/child" },
      { kind: "mcp", fqn: "azure/mcp", origin: "file:/mcp/azure" },
    ]);
  });

  it("does not orphan a dropped dependency still referenced by another installed entry", async () => {
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", "file:/skill/root", "public/root")])),
    );
    getTreeExecute.mockReturnValue(
      okAsync(
        graph([
          node("skill", "file:/skill/root", "public/root", { skills: ["file:/skill/child"] }),
          node("skill", "file:/skill/child", "public/child"),
        ]),
      ),
    );
    await saveSkill(skillEntity("public/root", "file:/skill/root", { skills: ["public/child"] }));
    await saveSkill(skillEntity("public/child", "file:/skill/child"));
    await saveSkill(skillEntity("public/other", "file:/skill/other", { skills: ["public/child"] }));

    const plan = (await useCase.execute({ kind: "skill", fqn: "public/root" }))._unsafeUnwrap();

    expect(plan.orphans).toEqual([]);
  });

  it("short-circuits a root identity change", async () => {
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", "file:/skill/entry", "public/new-name", { version: "2.0.0" })])),
    );
    getTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", "file:/skill/entry", "public/old-name", { version: "1.0.0" })])),
    );
    await saveSkill(skillEntity("public/old-name", "file:/skill/entry", { version: "1.0.0" }));

    const plan = (await useCase.execute({ kind: "skill", fqn: "public/old-name" }))._unsafeUnwrap();

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
    await saveSkill(installed);
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", installed.origin, installed.fqn)])),
    );
    getTreeExecute.mockReturnValue(
      okAsync(graph([node("skill", installed.origin, installed.fqn)])),
    );

    const plan = (await useCase.execute({ kind: "skill", fqn: installed.fqn }))._unsafeUnwrap();

    expect(getUpstreamTreeExecute).toHaveBeenCalledWith({
      kind: "skill",
      origin: installed.origin,
    });
    expect(plan.rootOrigin).toBe(installed.origin);
  });

  it("returns NotFound for an invalid sync fqn", async () => {
    const res = await useCase.execute({ kind: "skill", fqn: "not-a-fqn" });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: "not-a-fqn" });
    expect(getUpstreamTreeExecute).not.toHaveBeenCalled();
  });

  it("flags upstream fqn collisions with a different installed origin", async () => {
    await saveMcp(mcpEntity("azure/mcp", "file:/mcp/existing"));
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("mcp", "file:/mcp/new", "azure/mcp")])),
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
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(
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
    await saveAgent(
      agentEntity("public/root", "file:/agent/root", { agents: [installedAgent.fqn] }),
    );
    await saveAgent(installedAgent);
    getUpstreamTreeExecute.mockReturnValue(
      okAsync(graph([node("agent", "file:/agent/root", "public/root")])),
    );
    getTreeExecute.mockReturnValue(
      okAsync(
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

  it("short-circuits with rootAlreadyInstalled when install-path origin is already installed", async () => {
    await saveSkill(skillEntity("public/root", "file:/skill/root"));

    const plan = (
      await useCase.execute({ kind: "skill", origin: "file:/skill/root" })
    )._unsafeUnwrap();

    expect(plan.rootAlreadyInstalled).toBe(true);
    expect(plan.upToDate).toBe(true);
    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadyInstalled).toEqual([]);
    expect(getUpstreamTreeExecute).not.toHaveBeenCalled();
  });
});
