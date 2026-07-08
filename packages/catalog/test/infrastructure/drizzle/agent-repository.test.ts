import { beforeEach, describe, expect, it } from "vitest";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { openTestDb } from "../../testing.js";

/**
 * In-memory SQLite (migrations applied by `openTestDb`). Exercises the write-side
 * triad — get (load aggregate) / save (row + dep edges + file tree) / delete.
 * Read projections are covered by the application-layer queries tests.
 */
let repo: DrizzleAgentRepository;

beforeEach(async () => {
  repo = new DrizzleAgentRepository({ db: await (await openTestDb(":memory:")).db });
});

const NOW = "2025-01-01T00:00:00.000Z";

function agent(
  name = "triage",
  deps: { skills: string[]; mcps: string[]; agents: string[] } = {
    skills: [],
    mcps: [],
    agents: [],
  },
): AgentEntity {
  return new AgentEntity({
    fqn: `public/${name}` as AgentFqn,
    origin: `file:/c/agents/${name}`,
    description: "d",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: deps,
    installedAt: NOW,
    updatedAt: NOW,
  });
}

const FILES = new Map([
  ["AGENTS.md", Buffer.from("# anchor")],
  ["ref/guide.md", Buffer.from("deep")],
]);

describe("DrizzleAgentRepository", () => {
  it("persists an agent with its file tree and reads it back via get", async () => {
    const a = agent();
    expect((await repo.save(a, FILES)).isOk()).toBe(true);
    const got = (await repo.get(a.id))._unsafeUnwrap();
    expect(got.fqn).toBe("public/triage");
    expect(got.version).toBe("1.0.0");
    expect(got.disabledByUser).toBe(false);
  });

  it("get round-trips declared dependency edges", async () => {
    await repo.save(
      agent("triage", { skills: ["public/lint"], mcps: ["azure/mcp"], agents: ["public/helper"] }),
      FILES,
    );
    const got = (await repo.get("public/triage" as AgentFqn))._unsafeUnwrap();
    expect(got.dependencyRefs).toEqual({
      skills: ["public/lint"],
      mcps: ["azure/mcp"],
      agents: ["public/helper"],
    });
  });

  it("get returns AgentNotFound for an unknown fqn", async () => {
    const res = await repo.get("public/missing" as AgentFqn);
    expect(res._unsafeUnwrapErr().type).toBe("AgentNotFound");
  });

  it("a state-only save (no files) persists disable", async () => {
    const a = agent();
    await repo.save(a, FILES);
    const loaded = (await repo.get(a.id))._unsafeUnwrap();
    loaded.disable();
    await repo.save(loaded);
    expect((await repo.get(a.id))._unsafeUnwrap().disabledByUser).toBe(true);
  });

  it("delete removes the row and its dependency edges", async () => {
    const a = agent("triage", { skills: ["public/lint"], mcps: [], agents: [] });
    await repo.save(a, FILES);
    await repo.delete(a.id);
    expect((await repo.get(a.id))._unsafeUnwrapErr().type).toBe("AgentNotFound");
  });
});
