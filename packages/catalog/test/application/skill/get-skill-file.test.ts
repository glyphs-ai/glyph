import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSkillFileUseCase } from "../../../src/application/skill/get-skill-file.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

let skillRepo: MockProxy<SkillRepository>;
let useCase: GetSkillFileUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  useCase = new GetSkillFileUseCase({ skillRepo });
});

describe("GetSkillFileUseCase — read paths", () => {
  it("returns file bytes for a relPath", async () => {
    const content = Buffer.from("# tool-use");
    skillRepo.getFile.mockReturnValue(okAsync(content));
    const res = await useCase.execute({ id: SKILL_ID, relPath: "SKILL.md" });
    expect(res._unsafeUnwrap()).toBe(content);
    expect(skillRepo.getFile).toHaveBeenCalledWith(SKILL_ID, "SKILL.md");
  });

  it("returns null when the relPath is absent", async () => {
    skillRepo.getFile.mockReturnValue(okAsync(null));
    const res = await useCase.execute({ id: SKILL_ID, relPath: "missing.md" });
    expect(res._unsafeUnwrap()).toBeNull();
  });
});

describe("GetSkillFileUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.getFile", async () => {
    skillRepo.getFile.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID, relPath: "SKILL.md" });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
