import { describe, expect, it } from "vitest";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { SkillMapper } from "../../../src/infrastructure/drizzle/skill-mapper.js";
import type {
  SkillRow,
  SkillSkillDepRow,
} from "../../../src/infrastructure/drizzle/skill-schema.js";

type SkillDepRow = SkillSkillDepRow;

const FQN = "public/tool-use" as SkillFqn;

const ROW: SkillRow = {
  fqn: "public/tool-use",
  origin: "file:/c/skills/tool-use",
  description: "uses tools",
  version: "2.0.0",
  prereqs: null,
  prereqsAck: 1,
  installedAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

function sdep(targetFqn: string): SkillDepRow {
  return { sourceFqn: "public/tool-use", targetFqn };
}

describe("SkillMapper.toDomain", () => {
  it("rehydrates an entity, converting int prereqsAck to boolean", () => {
    const e = SkillMapper.toDomain({ ...ROW, prereqsAck: 0, prereqs: "needs key" }, [], []);
    expect(e).toBeInstanceOf(SkillEntity);
    expect(e.fqn).toBe("public/tool-use");
    expect(e.prereqs).toBe("needs key");
    expect(e.prereqsAck).toBe(false);
  });

  it("maps null prereqs to undefined", () => {
    expect(SkillMapper.toDomain(ROW, [], []).prereqs).toBeUndefined();
  });

  it("collects skill + mcp dependency targets", () => {
    const e = SkillMapper.toDomain(ROW, [sdep("public/base")], [sdep("azure/mcp")]);
    expect(e.dependencyRefs).toEqual({ skills: ["public/base"], mcps: ["azure/mcp"] });
  });
});

describe("SkillMapper.toRow", () => {
  function entity(over: { prereqs: string | undefined; prereqsAck: boolean }) {
    return new SkillEntity({
      fqn: FQN,
      origin: ROW.origin,
      description: ROW.description,
      version: ROW.version,
      prereqs: over.prereqs,
      prereqsAck: over.prereqsAck,
      dependencyRefs: { skills: [], mcps: [] },
      installedAt: ROW.installedAt,
      updatedAt: ROW.updatedAt,
    });
  }

  it("flattens an entity, converting prereqsAck boolean to int", () => {
    expect(SkillMapper.toRow(entity({ prereqs: "needs key", prereqsAck: true }))).toEqual({
      ...ROW,
      prereqs: "needs key",
      prereqsAck: 1,
    });
  });

  it("writes null prereqs / 0 ack for an unacked fresh skill", () => {
    const row = SkillMapper.toRow(entity({ prereqs: undefined, prereqsAck: false }));
    expect(row.prereqs).toBeNull();
    expect(row.prereqsAck).toBe(0);
  });
});

describe("SkillMapper dependency + file row flattening", () => {
  const e = new SkillEntity({
    fqn: FQN,
    origin: ROW.origin,
    description: ROW.description,
    version: ROW.version,
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: ["public/base"], mcps: ["azure/mcp"] },
    installedAt: ROW.installedAt,
    updatedAt: ROW.updatedAt,
  });

  it("emits skill + mcp dependency edges", () => {
    expect(SkillMapper.toSkillDepRows(e)).toEqual([
      { sourceFqn: "public/tool-use", targetFqn: "public/base" },
    ]);
    expect(SkillMapper.toMcpDepRows(e)).toEqual([
      { sourceFqn: "public/tool-use", targetFqn: "azure/mcp" },
    ]);
  });

  it("maps the file tree to (skillFqn, relPath, content) rows", () => {
    expect(SkillMapper.toFileRows(e, new Map([["SKILL.md", Buffer.from("a")]]))).toEqual([
      { skillFqn: "public/tool-use", relPath: "SKILL.md", content: Buffer.from("a") },
    ]);
  });
});
