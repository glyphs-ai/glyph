import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListAgentEntriesUseCase } from "../../../src/application/agent/list-agent-entries.js";
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
const MCP_ID = McpFqnSchema.parse("azure/mcp");

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
let useCase: ListAgentEntriesUseCase;

beforeEach(() => {
  agentRepo = mock<AgentRepository>();
  skillRepo = mock<SkillRepository>();
  mcpRepo = mock<McpRepository>();
  skillRepo.list.mockReturnValue(okAsync([]));
  agentRepo.list.mockReturnValue(okAsync([]));
  mcpRepo.list.mockReturnValue(okAsync([]));
  useCase = new ListAgentEntriesUseCase({ agentRepo, skillRepo, mcpRepo });
});

describe("ListAgentEntriesUseCase — read paths", () => {
  it("returns an empty array when no agents are installed", async () => {
    const entries = (await useCase.execute({}))._unsafeUnwrap();

    expect(entries).toEqual([]);
  });

  it("returns a ready entry when dependencies are satisfied", async () => {
    const entity = agentEntity({
      dependencyRefs: { skills: [SKILL_ID], mcps: [MCP_ID], agents: [] },
    });
    agentRepo.list.mockReturnValue(okAsync([entity]));
    skillRepo.list.mockReturnValue(okAsync([skillEntity()]));
    mcpRepo.list.mockReturnValue(okAsync([mcpEntity()]));

    const entries = (await useCase.execute({}))._unsafeUnwrap();

    expect(entries).toEqual([{ agent: agentDto(entity), status: "ready", coordEligible: false }]);
  });

  it("returns blocked reasons for prereqs, disabled state, and missing dependencies", async () => {
    const entity = agentEntity({
      prereqs: "Set token",
      prereqsAck: false,
      disabledByUser: true,
      dependencyRefs: { skills: [SKILL_ID], mcps: [MCP_ID], agents: [] },
    });
    agentRepo.list.mockReturnValue(okAsync([entity]));

    const entries = (await useCase.execute({}))._unsafeUnwrap();

    expect(entries).toEqual([
      {
        agent: agentDto(entity),
        status: "blocked",
        coordEligible: false,
        blockedReason: {
          needsPrereqsAck: true,
          disabledByUser: true,
          missingDeps: [
            { kind: "skill", name: SKILL_ID },
            { kind: "mcp", name: MCP_ID },
          ],
        },
        missingDeps: [
          { kind: "skill", name: SKILL_ID },
          { kind: "mcp", name: MCP_ID },
        ],
      },
    ]);
  });

  it("marks an agent blocked when a skill dependency is blocked", async () => {
    const entity = agentEntity({ dependencyRefs: { skills: [SKILL_ID], mcps: [], agents: [] } });
    const blockedSkill = skillEntity({ fqn: SKILL_ID, prereqs: "Do setup", prereqsAck: false });
    agentRepo.list.mockReturnValue(okAsync([entity]));
    skillRepo.list.mockReturnValue(okAsync([blockedSkill]));

    const entries = (await useCase.execute({}))._unsafeUnwrap();

    expect(entries[0]?.blockedReason).toEqual({ blockedDeps: [{ kind: "skill", fqn: SKILL_ID }] });
  });
});

describe("ListAgentEntriesUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from skill listing", async () => {
    const cause = new Error("skill-db");
    skillRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({});

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });

  it("propagates DatabaseUnavailable from agent listing", async () => {
    const cause = new Error("agent-db");
    agentRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));

    const res = await useCase.execute({});

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });

  it("propagates DatabaseUnavailable from mcp listing", async () => {
    const cause = new Error("mcp-db");
    mcpRepo.list.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause }));
    agentRepo.list.mockReturnValue(okAsync([agentEntity({ fqn: AGENT_ID })]));

    const res = await useCase.execute({});

    expect(res._unsafeUnwrapErr()).toEqual({ type: "DatabaseUnavailable", cause });
  });
});
