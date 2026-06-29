import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListSkillFilesUseCase } from "../../../src/application/skill/list-skill-files.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const databaseError = { type: "DatabaseUnavailable", cause: new Error("db down") } as const;

let skillRepo: MockProxy<SkillRepository>;
let useCase: ListSkillFilesUseCase;

beforeEach(() => {
  skillRepo = mock<SkillRepository>();
  useCase = new ListSkillFilesUseCase({ skillRepo });
});

describe("ListSkillFilesUseCase — read paths", () => {
  it("returns file entries from the repository", async () => {
    const entries = [
      { relPath: "SKILL.md", size: 12 },
      { relPath: "references/example.md", size: 4 },
    ];
    skillRepo.listFilePaths.mockReturnValue(okAsync(entries));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual(entries);
  });
});

describe("ListSkillFilesUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.listFilePaths", async () => {
    skillRepo.listFilePaths.mockReturnValue(errAsync(databaseError));
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toBe(databaseError);
  });
});
