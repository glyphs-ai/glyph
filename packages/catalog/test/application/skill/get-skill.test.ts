import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetSkillUseCase } from "../../../src/application/skill/get-skill.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
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
let useCase: GetSkillUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new GetSkillUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetSkillUseCase — read paths", () => {
  it("propagates SkillNotFound when the skill is not installed", async () => {
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });

  it("returns the projected Skill DTO with dependencies and orphaned=false", async () => {
    const entity = skill({ dependencyRefs: { skills: ["public/child"], mcps: [MCP_ID] } });
    (await skillRepo.save(entity))._unsafeUnwrap();
    (await agentRepo.save(agentWithSkill()))._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual(skillDto(entity, false));
  });
});
