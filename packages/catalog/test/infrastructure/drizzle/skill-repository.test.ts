import { beforeEach, describe, expect, it } from "vitest";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

/**
 * Uses in-memory SQLite with migrations applied by `openDb`. Repository
 * reads and writes exercise persisted metadata, dependency edges, and files.
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

describe("DrizzleSkillRepository — round-trip + reads", () => {
  it("persists a skill + tree and reads it back", async () => {
    const s = skill();
    expect((await repo.save(s, FILES)).isOk()).toBe(true);
    const got = (await repo.get(s.id))._unsafeUnwrap();
    expect(got.fqn).toBe("public/tool-use");
    expect(got.prereqsAck).toBe(true);
  });

  it("getByOrigin resolves the same entity", async () => {
    const s = skill();
    await repo.save(s, FILES);
    expect((await repo.getByOrigin(s.origin))._unsafeUnwrap().id).toBe(s.id);
  });

  it("findByFqn / findByOrigin resolve the entity, or undefined when absent", async () => {
    const s = skill();
    await repo.save(s, FILES);
    expect((await repo.findByFqn(s.id))._unsafeUnwrap()?.id).toBe(s.id);
    expect((await repo.findByOrigin(s.origin))._unsafeUnwrap()?.id).toBe(s.id);
    expect((await repo.findByFqn("public/none" as SkillFqn))._unsafeUnwrap()).toBeUndefined();
    expect((await repo.findByOrigin("file:/c/skills/none"))._unsafeUnwrap()).toBeUndefined();
  });

  it("get returns SkillNotFound for an unknown fqn", async () => {
    expect((await repo.get("public/missing" as SkillFqn))._unsafeUnwrapErr().type).toBe(
      "SkillNotFound",
    );
  });

  it("serves the SKILL.md anchor and individual files", async () => {
    const s = skill();
    await repo.save(s, FILES);
    expect((await repo.getAnchor(s.id))._unsafeUnwrap()).toBe("# anchor");
    expect((await repo.listFilePaths(s.id))._unsafeUnwrap().map((p) => p.relPath)).toEqual([
      "SKILL.md",
      "ref/x.md",
    ]);
    expect((await repo.getFile(s.id, "ref/x.md"))._unsafeUnwrap()?.toString()).toBe("deep");
  });
});

describe("DrizzleSkillRepository — list + deps + delete", () => {
  it("lists skills ordered by fqn", async () => {
    await repo.save(skill("zeta"), FILES);
    await repo.save(skill("alpha"), FILES);
    expect((await repo.list())._unsafeUnwrap().map((s) => s.fqn)).toEqual([
      "public/alpha",
      "public/zeta",
    ]);
  });

  it("records edges and answers existsUsing* probes", async () => {
    await repo.save(skill("tool-use", { skills: ["public/base"], mcps: ["azure/mcp"] }), FILES);
    expect((await repo.existsUsingSkill("public/base" as SkillFqn))._unsafeUnwrap()).toBe(true);
    expect((await repo.existsUsingMcp("azure/mcp" as McpFqn))._unsafeUnwrap()).toBe(true);
    expect((await repo.existsUsingSkill("public/none" as SkillFqn))._unsafeUnwrap()).toBe(false);
  });

  it("delete removes the row and clears its dependency edges", async () => {
    const s = skill("tool-use", { skills: ["public/base"], mcps: [] });
    await repo.save(s, FILES);
    await repo.delete(s.id);
    expect((await repo.get(s.id))._unsafeUnwrapErr().type).toBe("SkillNotFound");
    expect((await repo.existsUsingSkill("public/base" as SkillFqn))._unsafeUnwrap()).toBe(false);
  });
});
