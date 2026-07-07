import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetSkillFileUseCase } from "../../../src/application/skill/get-skill-file.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");

function skill(): SkillEntity {
  return new SkillEntity({
    fqn: SKILL_ID,
    origin: "file:///skills/tool-use",
    description: "Tool use",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: [], mcps: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let db: Db;
let close: () => void;
let skillRepo: DrizzleSkillRepository;
let useCase: GetSkillFileUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new GetSkillFileUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetSkillFileUseCase — read paths", () => {
  it("returns file bytes for a relPath", async () => {
    const content = Buffer.from("# tool-use", "utf8");
    (await skillRepo.save(skill(), new Map([["SKILL.md", content]])))._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID, relPath: "SKILL.md" });
    expect(res._unsafeUnwrap()).toEqual(content);
  });

  it("returns null when the relPath is absent", async () => {
    (
      await skillRepo.save(skill(), new Map([["SKILL.md", Buffer.from("# tool-use", "utf8")]]))
    )._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID, relPath: "missing.md" });
    expect(res._unsafeUnwrap()).toBeNull();
  });
});
