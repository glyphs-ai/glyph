import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetSkillContentUseCase } from "../../../src/application/skill/get-skill-content.js";
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
let useCase: GetSkillContentUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new GetSkillContentUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetSkillContentUseCase — read paths", () => {
  it("returns anchor content for the requested skill", async () => {
    (
      await skillRepo.save(skill(), new Map([["SKILL.md", Buffer.from("# tool-use", "utf8")]]))
    )._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID, content: "# tool-use" });
  });

  it("propagates SkillNotFound when the anchor does not resolve", async () => {
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: SKILL_ID });
  });
});
