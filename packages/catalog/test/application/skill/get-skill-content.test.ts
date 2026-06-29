import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSkillContentUseCase } from "../../../src/application/skill/get-skill-content.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

let skillRepo: MockProxy<SkillRepository>;
let useCase: GetSkillContentUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  useCase = new GetSkillContentUseCase({ skillRepo });
});

describe("GetSkillContentUseCase — read paths", () => {
  it("returns anchor content for the requested skill", async () => {
    skillRepo.getAnchor.mockReturnValue(okAsync("# tool-use"));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID, content: "# tool-use" });
  });
});

describe("GetSkillContentUseCase — error channel", () => {
  it("propagates SkillNotFound from repo.getAnchor", async () => {
    skillRepo.getAnchor.mockReturnValue(errAsync({ type: "SkillNotFound", fqn: SKILL_ID }));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });

  it("propagates DatabaseUnavailable from repo.getAnchor", async () => {
    skillRepo.getAnchor.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
