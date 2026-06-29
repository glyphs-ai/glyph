import { err, errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import type { InstallAgentUseCase } from "../../../src/application/agent/install-agent.js";
import type { InstallMcpUseCase } from "../../../src/application/mcp/install-mcp.js";
import { ApplyPlanUseCase } from "../../../src/application/resolution/apply-plan.js";
import type {
  PlanNode,
  ResolvePlanResponse,
} from "../../../src/application/resolution/resolve-plan.js";
import type { InstallSkillUseCase } from "../../../src/application/skill/install-skill.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

function planNode(
  kind: "skill" | "agent" | "mcp",
  origin: string,
  fqn: string,
  opts: {
    disposition?: PlanNode["disposition"];
    wasAlreadyInstalled?: boolean;
    skills?: string[];
    mcps?: string[];
    agents?: string[];
  } = {},
): PlanNode {
  const dependencyRefs = {
    skills: opts.skills ?? [],
    mcps: opts.mcps ?? [],
    agents: opts.agents ?? [],
  };
  return {
    kind,
    origin,
    fqn,
    disposition: opts.disposition ?? "new",
    wasAlreadyInstalled: opts.wasAlreadyInstalled ?? false,
    deps: [...dependencyRefs.skills, ...dependencyRefs.mcps, ...dependencyRefs.agents],
    dependencyRefs,
  };
}

function plan(overrides: Partial<ResolvePlanResponse>): ResolvePlanResponse {
  return {
    rootOrigin: "file:/agent/root",
    rootKind: "agent",
    toInstall: [],
    alreadyInstalled: [],
    conflicts: [],
    orphans: [],
    upToDate: false,
    ...overrides,
  };
}

let installSkill: MockProxy<InstallSkillUseCase>;
let installAgent: MockProxy<InstallAgentUseCase>;
let installMcp: MockProxy<InstallMcpUseCase>;
let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let mcpRepo: MockProxy<McpRepository>;
let useCase: ApplyPlanUseCase;

beforeEach(() => {
  installSkill = mock<InstallSkillUseCase>();
  installAgent = mock<InstallAgentUseCase>();
  installMcp = mock<InstallMcpUseCase>();
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  mcpRepo = mock<McpRepository>();
  installSkill.execute.mockResolvedValue(
    ok({ id: "public/skill", origin: "file:/skill/root", prereqsAck: true }),
  );
  installAgent.execute.mockResolvedValue(
    ok({
      id: "public/agent",
      description: "agent",
      version: "1.0.0",
      prereqsAck: true,
      disabledByUser: false,
      skills: [],
      mcps: [],
      agents: [],
    }),
  );
  installMcp.execute.mockResolvedValue(ok({ id: "azure/mcp", origin: "file:/mcp/azure" }));
  skillRepo.delete.mockReturnValue(okAsync(undefined));
  agentRepo.delete.mockReturnValue(okAsync(undefined));
  mcpRepo.delete.mockReturnValue(okAsync(undefined));
  useCase = new ApplyPlanUseCase({
    installSkill,
    installAgent,
    installMcp,
    repos: { skill: skillRepo, agent: agentRepo, mcp: mcpRepo },
  });
});

describe("ApplyPlanUseCase — install pass", () => {
  it("installs each new node and resolves dependency origins to installed fqns", async () => {
    installSkill.execute.mockResolvedValue(
      ok({ id: "public/tool-use", origin: "file:/skill/tool-use", prereqsAck: true }),
    );
    installAgent.execute.mockResolvedValue(
      ok({
        id: "public/triage",
        description: "triage",
        version: "1.0.0",
        prereqs: "set TOKEN",
        prereqsAck: false,
        disabledByUser: false,
        skills: ["public/tool-use"],
        mcps: ["azure/mcp"],
        agents: [],
      }),
    );

    const res = (
      await useCase.execute({
        plan: plan({
          toInstall: [
            planNode("mcp", "file:/mcp/azure", "azure/mcp"),
            planNode("skill", "file:/skill/tool-use", "public/tool-use", {
              mcps: ["file:/mcp/azure"],
            }),
            planNode("agent", "file:/agent/triage", "public/triage", {
              skills: ["file:/skill/tool-use"],
              mcps: ["file:/mcp/azure"],
            }),
          ],
        }),
      })
    )._unsafeUnwrap();

    expect(installSkill.execute).toHaveBeenCalledWith({
      origin: "file:/skill/tool-use",
      dependencyRefs: { skills: [], mcps: ["azure/mcp"] },
    });
    expect(installAgent.execute).toHaveBeenCalledWith({
      origin: "file:/agent/triage",
      dependencyRefs: { skills: ["public/tool-use"], mcps: ["azure/mcp"], agents: [] },
    });
    expect(res.installed).toEqual([
      { kind: "mcp", fqn: "azure/mcp" },
      { kind: "skill", fqn: "public/tool-use", prereqsAck: true },
      { kind: "agent", fqn: "public/triage", prereqs: "set TOKEN", prereqsAck: false },
    ]);
    expect(res.failed).toEqual([]);
  });

  it("skips already-installed plan nodes", async () => {
    const res = (
      await useCase.execute({
        plan: plan({
          alreadyInstalled: [
            planNode("skill", "file:/skill/up", "public/up", {
              disposition: "up-to-date",
              wasAlreadyInstalled: true,
            }),
            planNode("skill", "file:/skill/touched", "public/touched", {
              disposition: "will-sync",
              wasAlreadyInstalled: true,
            }),
          ],
        }),
      })
    )._unsafeUnwrap();

    expect(res.skipped).toEqual([
      { kind: "skill", fqn: "public/up", reason: "up-to-date" },
      { kind: "skill", fqn: "public/touched", reason: "already-installed" },
    ]);
    expect(installSkill.execute).not.toHaveBeenCalled();
  });

  it("serializes install failures and poisons dependents", async () => {
    installSkill.execute.mockResolvedValue(
      err({
        type: "SourceUnavailable",
        origin: "file:/skill/tool-use",
        cause: new Error("network down"),
      }),
    );

    const res = (
      await useCase.execute({
        plan: plan({
          toInstall: [
            planNode("skill", "file:/skill/tool-use", "public/tool-use"),
            planNode("agent", "file:/agent/triage", "public/triage", {
              skills: ["file:/skill/tool-use"],
            }),
            planNode("mcp", "file:/mcp/azure", "azure/mcp"),
          ],
        }),
      })
    )._unsafeUnwrap();

    expect(res.failed).toEqual([
      {
        kind: "skill",
        fqn: "public/tool-use",
        error: { name: "FetchError", message: "network down" },
      },
    ]);
    expect(res.skipped).toEqual([{ kind: "agent", fqn: "public/triage", reason: "dep-failed" }]);
    expect(res.installed).toEqual([{ kind: "mcp", fqn: "azure/mcp" }]);
    expect(installAgent.execute).not.toHaveBeenCalled();
  });
});

describe("ApplyPlanUseCase — plan metadata", () => {
  it("deletes the old fqn before applying a root identity change", async () => {
    skillRepo.delete.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("busy") }),
    );
    installSkill.execute.mockResolvedValue(
      ok({ id: "public/new-name", origin: "file:/skill/entry", prereqsAck: true }),
    );

    const res = (
      await useCase.execute({
        plan: plan({
          rootOrigin: "file:/skill/entry",
          rootKind: "skill",
          identityChange: { kind: "skill", oldFqn: "public/old-name", newFqn: "public/new-name" },
          toInstall: [
            planNode("skill", "file:/skill/entry", "public/new-name", {
              disposition: "identity-changed",
              wasAlreadyInstalled: true,
            }),
          ],
        }),
      })
    )._unsafeUnwrap();

    expect(skillRepo.delete).toHaveBeenCalledWith("public/old-name" as SkillFqn);
    expect(res.installed).toEqual([{ kind: "skill", fqn: "public/new-name", prereqsAck: true }]);
  });

  it("passes conflicts and flagged orphans through unchanged", async () => {
    const res = (
      await useCase.execute({
        plan: plan({
          conflicts: [
            {
              kind: "mcp",
              origin: "file:/mcp/new",
              fqn: "azure/mcp",
              reason: { kind: "origin-conflict", existingOrigin: "file:/mcp/existing" },
            },
          ],
          orphans: [{ kind: "skill", fqn: "public/old-child", origin: "file:/skill/old-child" }],
        }),
      })
    )._unsafeUnwrap();

    expect(res.conflicts).toEqual([
      {
        kind: "mcp",
        origin: "file:/mcp/new",
        fqn: "azure/mcp",
        reason: { kind: "origin-conflict", existingOrigin: "file:/mcp/existing" },
      },
    ]);
    expect(res.orphansFlagged).toEqual([
      { kind: "skill", fqn: "public/old-child", origin: "file:/skill/old-child" },
    ]);
  });

  it("uses the per-kind repository for identity-change deletion", async () => {
    await useCase.execute({
      plan: plan({
        identityChange: { kind: "agent", oldFqn: "public/old-agent", newFqn: "public/new-agent" },
      }),
    });
    await useCase.execute({
      plan: plan({ identityChange: { kind: "mcp", oldFqn: "azure/old", newFqn: "azure/new" } }),
    });

    expect(agentRepo.delete).toHaveBeenCalledWith("public/old-agent" as AgentFqn);
    expect(mcpRepo.delete).toHaveBeenCalledWith("azure/old" as McpFqn);
  });
});
