import { describe, expect, it } from "vitest";
import { SkillEntity } from "../../src/domain/skill-entity.js";
import { SkillNameSchema, SkillScopeSchema } from "../../src/domain/skill-fqn.js";

const EMPTY_DEPS = { skills: [], mcps: [] };

function makeSkill(args?: { prereqs?: string }): SkillEntity {
  return SkillEntity.create({
    scope: SkillScopeSchema.parse("public"),
    name: SkillNameSchema.parse("tool-use"),
    origin: "file:/tmp/tool-use",
    description: "uses tools",
    version: "1.0.0",
    prereqs: args?.prereqs,
    dependencyRefs: EMPTY_DEPS,
    now: "2026-01-01T00:00:00.000Z",
  });
}

describe("SkillEntity.create", () => {
  it("auto-acknowledges prereqs when none are declared", () => {
    expect(makeSkill().prereqsAck).toBe(true);
  });

  it("leaves prereqs unacknowledged when declared", () => {
    expect(makeSkill({ prereqs: "set GITHUB_TOKEN" }).prereqsAck).toBe(false);
  });

  it("seeds installedAt and updatedAt from `now`", () => {
    const s = makeSkill();
    expect(s.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("exposes id as the fqn", () => {
    expect(makeSkill().id).toBe("public/tool-use");
  });
});

describe("SkillEntity.acknowledgePrereqs", () => {
  it("marks prereqs acknowledged and is idempotent", () => {
    const s = makeSkill({ prereqs: "set GITHUB_TOKEN" });
    expect(s.prereqsAck).toBe(false);
    s.acknowledgePrereqs();
    expect(s.prereqsAck).toBe(true);
    s.acknowledgePrereqs();
    expect(s.prereqsAck).toBe(true);
  });
});
