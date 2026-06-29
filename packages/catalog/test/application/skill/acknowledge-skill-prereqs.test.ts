import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { AcknowledgePrereqsUseCase } from "../../../src/application/skill/acknowledge-skill-prereqs.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

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

let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let useCase: AcknowledgePrereqsUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  skillRepo.save.mockReturnValue(okAsync(undefined));
  skillRepo.list.mockReturnValue(okAsync([]));
  agentRepo.list.mockReturnValue(okAsync([]));
  useCase = new AcknowledgePrereqsUseCase({ skillRepo, agentRepo });
});

describe("AcknowledgePrereqsUseCase — mutation paths", () => {
  it("acknowledges prereqs, saves the entity, and returns the Skill DTO", async () => {
    const entity = skill();
    skillRepo.get.mockReturnValue(okAsync(entity));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual(skillDto(entity, true));
    expect(entity.prereqsAck).toBe(true);
    expect(skillRepo.save).toHaveBeenCalledWith(entity);
  });
});

describe("AcknowledgePrereqsUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.get", async () => {
    skillRepo.get.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: SKILL_ID }));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
    expect(skillRepo.save).not.toHaveBeenCalled();
  });

  it("propagates DatabaseUnavailable from repo.save", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill()));
    skillRepo.save.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from agentRepo.list", async () => {
    skillRepo.get.mockReturnValue(okAsync(skill()));
    agentRepo.list.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
