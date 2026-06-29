import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { UninstallSkillUseCase } from "../../../src/application/skill/uninstall-skill.js";
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

let skillRepo: MockProxy<SkillRepository>;
let agentRepo: MockProxy<AgentRepository>;
let useCase: UninstallSkillUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  agentRepo = mock<AgentRepository>();
  skillRepo.get.mockReturnValue(okAsync(skill()));
  skillRepo.existsUsingSkill.mockReturnValue(okAsync(false));
  agentRepo.existsUsingSkill.mockReturnValue(okAsync(false));
  skillRepo.delete.mockReturnValue(okAsync(undefined));
  useCase = new UninstallSkillUseCase({ skillRepo, agentRepo });
});

describe("UninstallSkillUseCase — mutation paths", () => {
  it("deletes a skill when no installed agent or skill depends on it", async () => {
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID });
    expect(skillRepo.delete).toHaveBeenCalledWith(SKILL_ID);
  });

  it("refuses to delete a skill an agent depends on", async () => {
    agentRepo.existsUsingSkill.mockReturnValue(okAsync(true));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: SKILL_ID });
    expect(skillRepo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a skill another skill depends on", async () => {
    skillRepo.existsUsingSkill.mockReturnValue(okAsync(true));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: SKILL_ID });
    expect(skillRepo.delete).not.toHaveBeenCalled();
  });
});

describe("UninstallSkillUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.get", async () => {
    skillRepo.get.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: SKILL_ID }));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });

  it("propagates DatabaseUnavailable from agentRepo.existsUsingSkill", async () => {
    agentRepo.existsUsingSkill.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from skillRepo.existsUsingSkill", async () => {
    skillRepo.existsUsingSkill.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });

  it("propagates DatabaseUnavailable from repo.delete", async () => {
    skillRepo.delete.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
