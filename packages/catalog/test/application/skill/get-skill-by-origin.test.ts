import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetSkillByOriginUseCase } from "../../../src/application/skill/get-skill-by-origin.js";
import { SkillEntity, type SkillEntityArgs } from "../../../src/domain/skill-entity.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const SKILL_ID = SkillFqnSchema.parse("public/tool-use");
const ORIGIN = "file:///skills/tool-use";

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

let db: Db;
let close: () => void;
let skillRepo: DrizzleSkillRepository;
let useCase: GetSkillByOriginUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new GetSkillByOriginUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetSkillByOriginUseCase — read paths", () => {
  it("returns the projected skill identity for an origin", async () => {
    (await skillRepo.save(skill()))._unsafeUnwrap();
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrap()).toEqual({ id: SKILL_ID, origin: ORIGIN, version: "1.0.0" });
  });

  it("propagates SkillNotFound when the origin does not resolve", async () => {
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "SkillNotFound", fqn: ORIGIN });
  });
});
