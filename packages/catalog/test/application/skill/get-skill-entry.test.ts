import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetSkillEntryUseCase } from "../../../src/application/skill/get-skill-entry.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import type { Db } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";
import { openTestDb } from "../../testing.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const CHILD_SKILL_ID = SkillFqnSchema.parse("public/child");
const MISSING_SKILL_ID = "public/missing";
const MCP_ID = McpFqnSchema.parse("azure/mcp");
const AGENT_ID = AgentFqnSchema.parse("public/triage");

function skill(overrides: Partial<SkillEntityArgs> = {}): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: "file:///skills/tool-use",
    description: "Tool use",
    version: "1.0.0",
    prereqs: "set GITHUB_TOKEN",
    prereqsAck: false,
    dependencyRefs: { skills: [], mcps: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  });
}

function agentWithSkill(skillFqn = SKILL_ID): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: "file:///agents/triage",
    description: "Triage",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [skillFqn], mcps: [], agents: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: "file:///mcps/azure",
    spec: '{"name":"azure/mcp"}',
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

function skillDto(entity: SkillEntity, orphaned: boolean) {
  const dependencies =
    entity.dependencyRefs.skills.length > 0 || entity.dependencyRefs.mcps.length > 0
      ? {
          ...(entity.dependencyRefs.skills.length > 0
            ? { skills: entity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
            : {}),
          ...(entity.dependencyRefs.mcps.length > 0
            ? { mcps: entity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
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
    orphaned,
    installedAt: entity.installedAt,
    updatedAt: entity.updatedAt,
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

let db: Db;
let close: () => void;
let skillRepo: DrizzleSkillRepository;
let agentRepo: DrizzleAgentRepository;
let mcpRepo: DrizzleMcpRepository;
let useCase: GetSkillEntryUseCase;

beforeEach(async () => {
  const opened = await openTestDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  mcpRepo = new DrizzleMcpRepository({ db });
  useCase = new GetSkillEntryUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetSkillEntryUseCase — read paths", () => {
  it("returns null when the skill is not installed", async () => {
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toBeNull();
  });

  it("returns a ready entry when the skill is referenced and dependencies are present", async () => {
    const child = skill({ fqn: CHILD_SKILL_ID, prereqs: undefined, prereqsAck: true });
    const entity = skill({
      prereqsAck: true,
      dependencyRefs: { skills: [CHILD_SKILL_ID], mcps: [MCP_ID] },
    });
    (await skillRepo.save(child))._unsafeUnwrap();
    (await skillRepo.save(entity))._unsafeUnwrap();
    (await agentRepo.save(agentWithSkill()))._unsafeUnwrap();
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual({ skill: skillDto(entity, false), status: "ready" });
  });

  it("returns blocked reasons and top-level missingDeps for unmet conditions", async () => {
    const entity = skill({ dependencyRefs: { skills: [MISSING_SKILL_ID], mcps: ["missing/mcp"] } });
    (await skillRepo.save(entity))._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual({
      skill: skillDto(entity, true),
      status: "blocked",
      blockedReason: {
        needsPrereqsAck: true,
        orphaned: true,
        missingDeps: [
          { kind: "skill", name: MISSING_SKILL_ID },
          { kind: "mcp", name: "missing/mcp" },
        ],
      },
      missingDeps: [
        { kind: "skill", name: MISSING_SKILL_ID },
        { kind: "mcp", name: "missing/mcp" },
      ],
    });
  });
});
