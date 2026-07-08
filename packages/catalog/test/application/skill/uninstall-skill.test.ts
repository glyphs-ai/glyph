import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UninstallSkillUseCase } from "../../../src/application/skill/uninstall-skill.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import type { Db } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";
import { openTestDb } from "../../testing.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const DEPENDENT_SKILL_ID = SkillFqnSchema.parse("public/reviewer");

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

let db: Db;
let close: () => void;
let skillRepo: DrizzleSkillRepository;
let agentRepo: DrizzleAgentRepository;
let useCase: UninstallSkillUseCase;

beforeEach(async () => {
  const opened = await openTestDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new UninstallSkillUseCase({
    skillRepo,
    queries: new DrizzleCatalogQueries({ db }),
  });
});

afterEach(() => {
  close();
});

describe("UninstallSkillUseCase — mutation paths", () => {
  it("deletes a skill when no installed agent or skill depends on it", async () => {
    (await skillRepo.save(skill()))._unsafeUnwrap();

    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID });
    expect((await skillRepo.get(SKILL_ID))._unsafeUnwrapErr()).toEqual({
      type: "SkillNotFound",
      fqn: SKILL_ID,
    });
  });

  it("refuses to delete a skill an agent depends on", async () => {
    (await skillRepo.save(skill()))._unsafeUnwrap();
    (await agentRepo.save(agentUsingSkill()))._unsafeUnwrap();

    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: SKILL_ID });
  });

  it("refuses to delete a skill another skill depends on", async () => {
    (await skillRepo.save(skill()))._unsafeUnwrap();
    (
      await skillRepo.save(
        skill({
          fqn: DEPENDENT_SKILL_ID,
          origin: "file:///skills/reviewer",
          dependencyRefs: { skills: [SKILL_ID], mcps: [] },
        }),
      )
    )._unsafeUnwrap();

    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: SKILL_ID });
  });
});

describe("UninstallSkillUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.get", async () => {
    const res = await useCase.execute({ id: SKILL_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });
});
