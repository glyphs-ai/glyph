import { beforeEach, describe, expect, it } from "vitest";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

/**
 * In-memory SQLite (migrations applied by `openDb`). Exercises the write-side
 * triad — get (load aggregate) / save (row + dep edges + file tree) / delete.
 * Read projections are covered by the application-layer queries tests.
 */
let repo: DrizzleSkillRepository;

beforeEach(() => {
  repo = new DrizzleSkillRepository({ db: openDb(":memory:").db });
});

const NOW = "2025-01-01T00:00:00.000Z";

function skill(
  name = "tool-use",
  deps: { skills: string[]; mcps: string[] } = { skills: [], mcps: [] },
): SkillEntity {
  return new SkillEntity({
    fqn: `public/${name}` as SkillFqn,
    origin: `file:/c/skills/${name}`,
    description: "d",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: deps,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

const FILES = new Map([
  ["SKILL.md", Buffer.from("# anchor")],
  ["ref/x.md", Buffer.from("deep")],
]);

describe("DrizzleSkillRepository", () => {
  it("persists a skill + tree and reads it back via get", async () => {
    const s = skill();
    expect((await repo.save(s, FILES)).isOk()).toBe(true);
    const got = (await repo.get(s.id))._unsafeUnwrap();
    expect(got.fqn).toBe("public/tool-use");
    expect(got.prereqsAck).toBe(true);
  });

  it("get round-trips declared dependency edges", async () => {
    await repo.save(skill("tool-use", { skills: ["public/base"], mcps: ["azure/mcp"] }), FILES);
    const got = (await repo.get("public/tool-use" as SkillFqn))._unsafeUnwrap();
    expect(got.dependencyRefs).toEqual({ skills: ["public/base"], mcps: ["azure/mcp"] });
  });

  it("get returns SkillNotFound for an unknown fqn", async () => {
    expect((await repo.get("public/missing" as SkillFqn))._unsafeUnwrapErr().type).toBe(
      "SkillNotFound",
    );
  });

  it("delete removes the row and its dependency edges", async () => {
    const s = skill("tool-use", { skills: ["public/base"], mcps: [] });
    await repo.save(s, FILES);
    await repo.delete(s.id);
    expect((await repo.get(s.id))._unsafeUnwrapErr().type).toBe("SkillNotFound");
  });
});
