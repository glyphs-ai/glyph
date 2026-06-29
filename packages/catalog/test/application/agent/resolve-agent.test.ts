import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ResolveAgentUseCase } from "../../../src/application/agent/resolve-agent.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpEntity, type McpEntityArgs } from "../../../src/domain/mcp-entity.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const CHILD_SKILL_ID = SkillFqnSchema.parse("public/child");
const MCP_ID = McpFqnSchema.parse("azure/mcp");
const asSkillFqn = (value: string) => SkillFqnSchema.parse(value);

function agentEntity(overrides: Partial<AgentEntityArgs> = {}): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: "file:///catalog/agents/triage",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps: [], agents: [] },
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function skillEntity(overrides: Partial<SkillEntityArgs> = {}): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: "file:///catalog/skills/tool-use",
    description: "Tool use",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: [], mcps: [] },
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function mcpEntity(overrides: Partial<McpEntityArgs> = {}): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: "file:///catalog/mcps/azure.json",
    spec: '{"name":"azure/mcp"}',
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function agentDto(entity: AgentEntity) {
  const dependencies =
    entity.dependencyRefs.skills.length > 0 ||
    entity.dependencyRefs.mcps.length > 0 ||
    entity.dependencyRefs.agents.length > 0
      ? {
          ...(entity.dependencyRefs.skills.length > 0
            ? { skills: entity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.mcps.length > 0
            ? { mcps: entity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.agents.length > 0
            ? { agents: entity.dependencyRefs.agents.map((fqn) => ({ fqn })) }
            : {}),
        }
      : undefined;
  return {
    fqn: entity.fqn,
    origin: entity.origin,
    description: entity.description,
    version: entity.version,
    ...(entity.prereqs !== undefined ? { prereqs: entity.prereqs } : {}),
    prereqsAck: entity.prereqsAck,
    disabledByUser: entity.disabledByUser,
    installedAt: entity.installedAt,
    updatedAt: entity.updatedAt,
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

let agentRepo: MockProxy<AgentRepository>;
let skillRepo: MockProxy<SkillRepository>;
let mcpRepo: MockProxy<McpRepository>;
let useCase: ResolveAgentUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  skillRepo = mock<SkillRepository>();
  mcpRepo = mock<McpRepository>();
  agentRepo.list.mockReturnValue(okAsync([]));
  skillRepo.list.mockReturnValue(okAsync([]));
  mcpRepo.list.mockReturnValue(okAsync([]));
  useCase = new ResolveAgentUseCase({ agentRepo, skillRepo, mcpRepo });
});

describe("ResolveAgentUseCase — read paths", () => {
  it("returns the agent with transitive skills in dependency order and resolved mcps", async () => {
    const root = agentEntity({
      dependencyRefs: { skills: [SKILL_ID], mcps: [MCP_ID], agents: [] },
    });
    const parentSkill = skillEntity({
      fqn: SKILL_ID,
      dependencyRefs: { skills: [CHILD_SKILL_ID], mcps: [] },
    });
    const childSkill = skillEntity({
      fqn: CHILD_SKILL_ID,
      origin: "file:///catalog/skills/child",
      dependencyRefs: { skills: [], mcps: [MCP_ID] },
    });
    agentRepo.list.mockReturnValue(okAsync([root]));
    skillRepo.list.mockReturnValue(okAsync([parentSkill, childSkill]));
    mcpRepo.list.mockReturnValue(okAsync([mcpEntity()]));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto.agent).toEqual(agentDto(root));
    expect(dto.skills.map((entry) => entry.skill.fqn)).toEqual([CHILD_SKILL_ID, SKILL_ID]);
    expect(dto.skills[0]?.skill).toMatchObject({ fqn: CHILD_SKILL_ID, orphaned: false });
    expect(dto.skills[1]?.skill.dependencies).toEqual({ skills: [{ fqn: CHILD_SKILL_ID }] });
    expect(dto.mcps).toEqual([{ fqn: MCP_ID }]);
  });

  it("omits missing skill and mcp dependencies from the resolved closure", async () => {
    const root = agentEntity({
      dependencyRefs: { skills: [asSkillFqn("public/missing")], mcps: [MCP_ID], agents: [] },
    });
    agentRepo.list.mockReturnValue(okAsync([root]));

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto.skills).toEqual([]);
    expect(dto.mcps).toEqual([]);
  });
});

describe("ResolveAgentUseCase — error channel", () => {
  it("returns AgentNotFound when the root agent is absent", async () => {
    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
  });

  it("propagates DatabaseUnavailable from agent listing", async () => {
    const cause = new Error("agent-db");
    agentRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });

  it("propagates DatabaseUnavailable from skill listing", async () => {
    const cause = new Error("skill-db");
    agentRepo.list.mockReturnValue(okAsync([agentEntity()]));
    skillRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });

  it("propagates DatabaseUnavailable from mcp listing", async () => {
    const cause = new Error("mcp-db");
    agentRepo.list.mockReturnValue(okAsync([agentEntity()]));
    mcpRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
