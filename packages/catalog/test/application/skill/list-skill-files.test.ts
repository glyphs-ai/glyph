import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListSkillFilesUseCase } from "../../../src/application/skill/list-skill-files.js";
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
let useCase: ListSkillFilesUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new ListSkillFilesUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("ListSkillFilesUseCase — read paths", () => {
  it("returns file entries from the repository", async () => {
    const entries = [
      { relPath: "SKILL.md", size: 12 },
      { relPath: "references/example.md", size: 4 },
    ];
    (
      await skillRepo.save(
        skill(),
        new Map([
          ["SKILL.md", Buffer.from("hello world!", "utf8")],
          ["references/example.md", Buffer.from("test", "utf8")],
        ]),
      )
    )._unsafeUnwrap();
    const res = await useCase.execute({ id: SKILL_ID });
    expect(res._unsafeUnwrap()).toEqual(entries);
  });
});
