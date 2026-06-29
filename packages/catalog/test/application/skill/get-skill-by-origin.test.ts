import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSkillByOriginUseCase } from "../../../src/application/skill/get-skill-by-origin.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const ORIGIN = "file:///skills/tool-use";
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

function skill(overrides: Partial<SkillEntityArgs> = {}): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: ORIGIN,
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
let useCase: GetSkillByOriginUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  useCase = new GetSkillByOriginUseCase({ skillRepo });
});

describe("GetSkillByOriginUseCase — read paths", () => {
  it("returns the projected skill identity for an origin", async () => {
    skillRepo.getByOrigin.mockReturnValue(okAsync(skill()));
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID, origin: ORIGIN, version: "1.0.0" });
  });
});

describe("GetSkillByOriginUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.getByOrigin", async () => {
    skillRepo.getByOrigin.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: ORIGIN }));
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: ORIGIN });
  });

  it("propagates DatabaseUnavailable from repo.getByOrigin", async () => {
    skillRepo.getByOrigin.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
