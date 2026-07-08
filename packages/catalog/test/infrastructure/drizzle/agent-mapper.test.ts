import { describe, expect, it } from "vitest";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { AgentMapper } from "../../../src/infrastructure/drizzle/agent-mapper.js";
import type {
  AgentRow,
  AgentSkillDepRow,
} from "../../../src/infrastructure/drizzle/agent-schema.js";

type AgentDepRow = AgentSkillDepRow;

const FQN = "public/triage" as AgentFqn;

const ROW: AgentRow = {
  fqn: "public/triage",
  origin: "file:/c/agents/triage",
  description: "triages issues",
  version: "1.2.3",
  prereqs: null,
  prereqsAck: 1,
  disabledByUser: 0,
  installedAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

function dep(targetFqn: string): AgentDepRow {
  return { sourceFqn: "public/triage", targetFqn };
}

describe("AgentMapper.toDomain", () => {
  it("rehydrates an entity, converting int flags to booleans", () => {
    const e = AgentMapper.toDomain(
      { ...ROW, prereqsAck: 1, disabledByUser: 1, prereqs: "needs token" },
      [],
      [],
      [],
    );
    expect(e).toBeInstanceOf(AgentEntity);
    expect(e.fqn).toBe("public/triage");
    expect(e.origin).toBe(ROW.origin);
    expect(e.version).toBe("1.2.3");
    expect(e.prereqs).toBe("needs token");
    expect(e.prereqsAck).toBe(true);
    expect(e.disabledByUser).toBe(true);
  });

  it("maps null prereqs to undefined and 0 flags to false", () => {
    const e = AgentMapper.toDomain(ROW, [], [], []);
    expect(e.prereqs).toBeUndefined();
    expect(e.prereqsAck).toBe(true);
    expect(e.disabledByUser).toBe(false);
  });

  it("collects dependency target fqns bucketed by kind", () => {
    const e = AgentMapper.toDomain(
      ROW,
      [dep("public/lint")],
      [dep("azure/mcp")],
      [dep("public/helper")],
    );
    expect(e.dependencyRefs).toEqual({
      skills: ["public/lint"],
      mcps: ["azure/mcp"],
      agents: ["public/helper"],
    });
  });
});

describe("AgentMapper.toRow", () => {
  function entity(over: {
    prereqs: string | undefined;
    prereqsAck: boolean;
    disabledByUser: boolean;
  }) {
    return new AgentEntity({
      fqn: FQN,
      origin: ROW.origin,
      description: ROW.description,
      version: ROW.version,
      prereqs: over.prereqs,
      prereqsAck: over.prereqsAck,
      disabledByUser: over.disabledByUser,
      dependencyRefs: { skills: [], mcps: [], agents: [] },
      installedAt: ROW.installedAt,
      updatedAt: ROW.updatedAt,
    });
  }

  it("flattens an entity, converting booleans to int flags", () => {
    const row = AgentMapper.toRow(
      entity({ prereqs: "needs token", prereqsAck: true, disabledByUser: true }),
    );
    expect(row).toEqual({ ...ROW, prereqs: "needs token", prereqsAck: 1, disabledByUser: 1 });
  });

  it("writes null prereqs and 0 flags for a fresh enabled agent", () => {
    const row = AgentMapper.toRow(
      entity({ prereqs: undefined, prereqsAck: false, disabledByUser: false }),
    );
    expect(row.prereqs).toBeNull();
    expect(row.prereqsAck).toBe(0);
    expect(row.disabledByUser).toBe(0);
  });
});

describe("AgentMapper dependency + file row flattening", () => {
  const e = new AgentEntity({
    fqn: FQN,
    origin: ROW.origin,
    description: ROW.description,
    version: ROW.version,
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: ["public/lint"], mcps: ["azure/mcp"], agents: ["public/helper"] },
    installedAt: ROW.installedAt,
    updatedAt: ROW.updatedAt,
  });

  it("emits (sourceFqn, targetFqn) edges per dependency kind", () => {
    expect(AgentMapper.toSkillDepRows(e)).toEqual([
      { sourceFqn: "public/triage", targetFqn: "public/lint" },
    ]);
    expect(AgentMapper.toMcpDepRows(e)).toEqual([
      { sourceFqn: "public/triage", targetFqn: "azure/mcp" },
    ]);
    expect(AgentMapper.toAgentDepRows(e)).toEqual([
      { sourceFqn: "public/triage", targetFqn: "public/helper" },
    ]);
  });

  it("maps the file tree to (agentFqn, relPath, content) rows", () => {
    const rows = AgentMapper.toFileRows(
      e,
      new Map([
        ["AGENTS.md", Buffer.from("hi")],
        ["ref/x.md", Buffer.from("y")],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      agentFqn: "public/triage",
      relPath: "AGENTS.md",
      content: Buffer.from("hi"),
    });
  });
});
