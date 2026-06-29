import { beforeEach, describe, expect, it } from "vitest";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";

/**
 * Uses in-memory SQLite with migrations applied by `openDb`. Repository
 * reads and writes exercise persisted metadata, dependency edges, and files.
 */
let repo: DrizzleAgentRepository;

beforeEach(() => {
  repo = new DrizzleAgentRepository({ db: openDb(":memory:").db });
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

describe("DrizzleAgentRepository — save + read round-trip", () => {
  it("persists an agent with its file tree and reads it back", async () => {
    const a = agent();
    expect((await repo.save(a, FILES)).isOk()).toBe(true);
    const got = (await repo.get(a.id))._unsafeUnwrap();
    expect(got.fqn).toBe("public/triage");
    expect(got.version).toBe("1.0.0");
    expect(got.disabledByUser).toBe(false);
  });

  it("findByFqn / findByOrigin resolve the same entity, or undefined when absent", async () => {
    const a = agent();
    await repo.save(a, FILES);
    expect((await repo.findByFqn(a.id))._unsafeUnwrap()?.id).toBe(a.id);
    expect((await repo.findByOrigin(a.origin))._unsafeUnwrap()?.id).toBe(a.id);
    expect((await repo.findByFqn("public/none" as AgentFqn))._unsafeUnwrap()).toBeUndefined();
    expect((await repo.findByOrigin("file:/c/agents/none"))._unsafeUnwrap()).toBeUndefined();
  });

  it("get returns AgentNotFound for an unknown fqn", async () => {
    const res = await repo.get("public/missing" as AgentFqn);
    expect(res._unsafeUnwrapErr().type).toBe("AgentNotFound");
  });

  it("serves the AGENTS.md anchor and individual files", async () => {
    const a = agent();
    await repo.save(a, FILES);
    expect((await repo.getAnchor(a.id))._unsafeUnwrap()).toBe("# anchor");
    const paths = (await repo.listFilePaths(a.id))._unsafeUnwrap();
    expect(paths.map((p) => p.relPath)).toEqual(["AGENTS.md", "ref/guide.md"]);
    expect((await repo.getFile(a.id, "ref/guide.md"))._unsafeUnwrap()?.toString()).toBe("deep");
    expect((await repo.getFile(a.id, "nope"))._unsafeUnwrap()).toBeNull();
  });

  it("streamFiles yields every file ordered by relPath", async () => {
    const a = agent();
    await repo.save(a, FILES);
    const seen: string[] = [];
    for await (const f of repo.streamFiles(a.id)) seen.push(f.relPath);
    expect(seen).toEqual(["AGENTS.md", "ref/guide.md"]);
  });
});

describe("DrizzleAgentRepository — list + state writes", () => {
  it("lists agents ordered by fqn", async () => {
    await repo.save(agent("zeta"), FILES);
    await repo.save(agent("alpha"), FILES);
    const all = (await repo.list())._unsafeUnwrap();
    expect(all.map((a) => a.fqn)).toEqual(["public/alpha", "public/zeta"]);
  });

  it("a state-only save (no files) persists disable without touching the tree", async () => {
    const a = agent();
    await repo.save(a, FILES);
    const loaded = (await repo.get(a.id))._unsafeUnwrap();
    loaded.disable();
    await repo.save(loaded);
    const reread = (await repo.get(a.id))._unsafeUnwrap();
    expect(reread.disabledByUser).toBe(true);
    expect((await repo.getAnchor(a.id))._unsafeUnwrap()).toBe("# anchor");
  });
});

describe("DrizzleAgentRepository — dependency edges", () => {
  it("records edges and answers existsUsing* probes", async () => {
    await repo.save(
      agent("triage", { skills: ["public/lint"], mcps: ["azure/mcp"], agents: ["public/helper"] }),
      FILES,
    );
    expect((await repo.existsUsingSkill("public/lint" as SkillFqn))._unsafeUnwrap()).toBe(true);
    expect((await repo.existsUsingMcp("azure/mcp" as McpFqn))._unsafeUnwrap()).toBe(true);
    expect((await repo.existsUsingAgent("public/helper" as AgentFqn))._unsafeUnwrap()).toBe(true);
    expect((await repo.existsUsingSkill("public/other" as SkillFqn))._unsafeUnwrap()).toBe(false);
  });

  it("delete removes the row and clears its dependency edges", async () => {
    const a = agent("triage", { skills: ["public/lint"], mcps: [], agents: [] });
    await repo.save(a, FILES);
    await repo.delete(a.id);
    expect((await repo.get(a.id))._unsafeUnwrapErr().type).toBe("AgentNotFound");
    expect((await repo.existsUsingSkill("public/lint" as SkillFqn))._unsafeUnwrap()).toBe(false);
  });
});
