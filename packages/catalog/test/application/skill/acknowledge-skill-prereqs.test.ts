import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcknowledgePrereqsUseCase } from "../../../src/application/skill/acknowledge-skill-prereqs.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");

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

function agentUsingSkill(): AgentEntity {
  return new AgentEntity({
    fqn: "public/triage" as AgentFqn,
    origin: "file:///catalog/agents/triage",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [SKILL_ID], mcps: [], agents: [] },
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
let useCase: AcknowledgePrereqsUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new AcknowledgePrereqsUseCase({
    skillRepo,
    queries: new DrizzleCatalogQueries({ db }),
  });
});

afterEach(() => {
  close();
});

describe("AcknowledgePrereqsUseCase — mutation paths", () => {
  it("acknowledges prereqs, saves the entity, and returns the Skill DTO", async () => {
    const entity = skill();
    (await skillRepo.save(entity))._unsafeUnwrap();

    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrap()).toEqual(skillDto(skill({ prereqsAck: true }), true));
    expect((await skillRepo.get(SKILL_ID))._unsafeUnwrap().prereqsAck).toBe(true);
  });

  it("returns orphaned=false when another installed entity references the skill", async () => {
    const entity = skill();
    (await skillRepo.save(entity))._unsafeUnwrap();
    (await agentRepo.save(agentUsingSkill()))._unsafeUnwrap();

    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrap()).toEqual(skillDto(skill({ prereqsAck: true }), false));
  });
});

describe("AcknowledgePrereqsUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.get", async () => {
    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });
});
