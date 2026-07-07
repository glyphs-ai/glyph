import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetAgentEntryUseCase } from "../../../src/application/agent/get-agent-entry.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { McpEntity, type McpEntityArgs } from "../../../src/domain/mcp-entity.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const CHILD_AGENT_ID = AgentFqnSchema.parse("public/worker");
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

let db: Db;
let close: () => void;
let agentRepo: DrizzleAgentRepository;
let skillRepo: DrizzleSkillRepository;
let mcpRepo: DrizzleMcpRepository;
let useCase: GetAgentEntryUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  skillRepo = new DrizzleSkillRepository({ db });
  mcpRepo = new DrizzleMcpRepository({ db });
  useCase = new GetAgentEntryUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetAgentEntryUseCase — read paths", () => {
  it("returns null when the agent is not installed", async () => {
    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto).toBeNull();
  });

  it("returns a ready entry for an enabled agent with satisfied dependencies", async () => {
    const entity = agentEntity({
      dependencyRefs: { skills: [SKILL_ID], mcps: [MCP_ID], agents: [CHILD_AGENT_ID] },
    });
    (await agentRepo.save(entity))._unsafeUnwrap();
    (await skillRepo.save(skillEntity()))._unsafeUnwrap();
    (await mcpRepo.save(mcpEntity()))._unsafeUnwrap();

    const entry = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(entry).toEqual({ agent: agentDto(entity), status: "ready", coordEligible: true });
  });

  it("returns blocked reasons for prereqs, disabled state, and missing dependencies", async () => {
    const entity = agentEntity({
      prereqs: "Set token",
      prereqsAck: false,
      disabledByUser: true,
      dependencyRefs: { skills: [SKILL_ID], mcps: [MCP_ID], agents: [] },
    });
    (await agentRepo.save(entity))._unsafeUnwrap();

    const entry = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(entry).toEqual({
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
    });
  });

  it("marks the agent blocked when a skill dependency is blocked", async () => {
    const entity = agentEntity({ dependencyRefs: { skills: [SKILL_ID], mcps: [], agents: [] } });
    const child = skillEntity({ fqn: SKILL_ID, prereqs: "Do setup", prereqsAck: false });
    (await agentRepo.save(entity))._unsafeUnwrap();
    (await skillRepo.save(child))._unsafeUnwrap();

    const entry = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(entry?.status).toBe("blocked");
    expect(entry?.blockedReason).toEqual({ blockedDeps: [{ kind: "skill", fqn: SKILL_ID }] });
  });
});
