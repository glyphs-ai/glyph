import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentFetcher, AgentService } from "../src/application/agent.service.js";
import {
  AgentNotFoundError,
  AgentOriginConflictError,
  AgentPlanStaleError,
} from "../src/contract/agent.errors.js";
import { AgentEntity } from "../src/domain/agent.entity.js";
import { AgentFrontmatterError, AgentUnresolvedDepError } from "../src/domain/agent.errors.js";
import { Origin } from "../src/domain/origin.js";
import type { EntryFile } from "../src/fetcher/index.js";
import { safeNormalize } from "../src/fetcher/origin.js";
import { AgentRepository } from "../src/persistence/agent.repository.js";
import { bootstrapCatalogDb } from "./helpers/bootstrap.js";

function makeFetcher(): {
  fetcher: AgentFetcher;
  set: (origin: string, files: Record<string, string>) => void;
} {
  const trees = new Map<string, Map<string, Buffer>>();
  const fetcher: AgentFetcher = {
    async fetchAnchor(origin) {
      const tree = trees.get(safeNormalize(origin));
      if (tree === undefined) throw new Error(`fake fetcher: no fixture for ${origin}`);
      const anchor = tree.get("AGENTS.md");
      if (anchor === undefined) throw new Error(`fake fetcher: no AGENTS.md for ${origin}`);
      return anchor.toString("utf8");
    },
    async *fetchTree(origin) {
      const tree = trees.get(safeNormalize(origin));
      if (tree === undefined) throw new Error(`fake fetcher: no fixture for ${origin}`);
      for (const [relPath, content] of tree) {
        yield { relPath, content } satisfies EntryFile;
      }
    },
  };
  return {
    fetcher,
    set(origin, files) {
      const map = new Map<string, Buffer>();
      for (const [k, v] of Object.entries(files)) map.set(k, Buffer.from(v, "utf8"));
      trees.set(safeNormalize(origin), map);
    },
  };
}

const ANCHOR = (name: string, deps: string = "") => `---
name: ${name}
description: x
version: 1.0.0
${deps}
---
# Body
`;

let orm: ReturnType<typeof bootstrapCatalogDb>;
let repo: AgentRepository;
let fetcher: ReturnType<typeof makeFetcher>;
let svc: AgentService;

beforeEach(async () => {
  orm = bootstrapCatalogDb();

  repo = new AgentRepository({ db: orm.db });
  fetcher = makeFetcher();
  svc = new AgentService({ repo, fetcher: fetcher.fetcher });
});

afterEach(async () => {
  try {
    orm.close();
  } catch {
    // already closed
  }
});

// ─── resolve ──────────────────────────────────────────────────

describe("AgentService.resolve", () => {
  it("returns a single-node plan for a leaf agent", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/agent");
    expect(plan.conflict).toBeNull();
    expect(plan.node).not.toBeNull();
    expect(plan.node!.fqn).toBe("public/agent");
    expect(plan.node!.depsRefs.skills).toEqual([]);
    expect(plan.node!.depsRefs.mcps).toEqual([]);
    expect(plan.node!.depsRefs.agents).toEqual([]);
  });

  it("captures the upstream version on the resolved node", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/agent");
    expect(plan.node!.version).toBe("1.0.0");
  });

  it("surfaces dep refs (does NOT recurse — facade's job)", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/web-search"
  mcps:
    - "file:/abs/mcps/azure"
  agents:
    - "file:/abs/agents/sub"`;
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent", deps) });
    const plan = await svc.resolve("file:/abs/agent");
    expect(plan.node!.depsRefs.skills).toEqual(["file:/abs/skills/web-search"]);
    expect(plan.node!.depsRefs.mcps).toEqual(["file:/abs/mcps/azure"]);
    expect(plan.node!.depsRefs.agents).toEqual(["file:/abs/agents/sub"]);
  });

  it("surfaces fetch failures as conflict", async () => {
    const plan = await svc.resolve("file:/abs/never");
    expect(plan.node).toBeNull();
    expect(plan.conflict?.reason.kind).toBe("fetch-failed");
  });

  it("surfaces parse failures as conflict", async () => {
    fetcher.set("file:/abs/bad", { "AGENTS.md": "no frontmatter" });
    const plan = await svc.resolve("file:/abs/bad");
    expect(plan.node).toBeNull();
    expect(plan.conflict?.reason.kind).toBe("parse-failed");
  });

  it("surfaces FQN-different-origin as conflict", async () => {
    fetcher.set("file:/abs/a", { "AGENTS.md": ANCHOR("agent") });
    await svc.install("file:/abs/a");

    fetcher.set("file:/abs/b", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/b");
    expect(plan.conflict?.reason.kind).toBe("origin-conflict");
  });
});

// ─── install ──────────────────────────────────────────────────

describe("AgentService.install", () => {
  it("installs from origin string (resolve + install)", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent"), "extra.txt": "extra" });
    const a = await svc.install("file:/abs/agent");
    expect(a.fqn).toBe("public/agent");
    const got = await svc.get("public/agent");
    expect(got).not.toBeNull();
    const files = new Map<string, Buffer>();
    for await (const f of svc.streamFiles("public/agent")) files.set(f.relPath, f.content);
    expect(files.get("extra.txt")?.toString("utf8")).toBe("extra");
  });

  it("installs from a resolved plan node", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/agent");
    expect(plan.node).not.toBeNull();
    const a = await svc.install(plan.node!);
    expect(a.fqn).toBe("public/agent");
  });

  it("upserts content under same origin", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent"), "data.txt": "v1" });
    await svc.install("file:/abs/agent");
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent"), "data.txt": "v2" });
    await svc.install("file:/abs/agent");
    const files = new Map<string, Buffer>();
    for await (const f of svc.streamFiles("public/agent")) files.set(f.relPath, f.content);
    expect(files.get("data.txt")?.toString("utf8")).toBe("v2");
  });

  it("rejects same FQN reinstall from different origin via resolve conflict", async () => {
    fetcher.set("file:/abs/a", { "AGENTS.md": ANCHOR("agent") });
    await svc.install("file:/abs/a");

    fetcher.set("file:/abs/b", { "AGENTS.md": ANCHOR("agent") });
    await expect(svc.install("file:/abs/b")).rejects.toThrow(AgentOriginConflictError);
  });

  it("throws AgentPlanStaleError when version changes between resolve and install", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/agent");
    expect(plan.node).not.toBeNull();
    fetcher.set("file:/abs/agent", {
      "AGENTS.md": ANCHOR("agent").replace("1.0.0", "2.0.0"),
    });
    await expect(svc.install(plan.node!)).rejects.toThrow(AgentPlanStaleError);
  });

  it("body-only upstream change does NOT trigger PlanStaleError", async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/agent");
    fetcher.set("file:/abs/agent", {
      "AGENTS.md": `${ANCHOR("agent")}\nNew body content.\n`,
    });
    const a = await svc.install(plan.node!);
    expect(a.fqn).toBe("public/agent");
  });

  it("install fails when fetched tree has no AGENTS.md", async () => {
    fetcher.set("file:/abs/bad", { "AGENTS.md": ANCHOR("agent") });
    const plan = await svc.resolve("file:/abs/bad");
    fetcher.set("file:/abs/bad", { "other.md": "x" });
    await expect(svc.install(plan.node!)).rejects.toThrow(AgentFrontmatterError);
  });
});

// ─── single-entity API ────────────────────────────────────────

describe("AgentService — single-entity API", () => {
  beforeEach(async () => {
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent") });
    await svc.install("file:/abs/agent");
  });

  it("get returns AgentEntity entity", async () => {
    const a = await svc.get("public/agent");
    expect(a).toBeInstanceOf(AgentEntity);
    expect(a!.fqn).toBe("public/agent");
  });

  it("getByOrigin normalizes the input so cross-separator file: lookups match", async () => {
    expect((await svc.getByOrigin("file:///abs/agent"))?.fqn).toBe("public/agent");
    expect((await svc.getByOrigin("file:/abs/agent/"))?.fqn).toBe("public/agent");
  });

  it("getByOrigin returns null without throwing on garbage input", async () => {
    expect(await svc.getByOrigin("not-a-valid-origin")).toBeNull();
    expect(await svc.getByOrigin("")).toBeNull();
  });

  it("has returns true / false", async () => {
    expect(await svc.has("public/agent")).toBe(true);
    expect(await svc.has("public/missing")).toBe(false);
  });

  it("list returns all installed agents", async () => {
    fetcher.set("file:/abs/other", { "AGENTS.md": ANCHOR("other") });
    await svc.install("file:/abs/other");
    const all = await svc.list();
    expect(all.map((a) => a.fqn).sort()).toEqual(["public/agent", "public/other"]);
  });

  it("delete removes the agent", async () => {
    await svc.delete("public/agent");
    expect(await svc.has("public/agent")).toBe(false);
  });

  it("delete throws NotFound for missing agent", async () => {
    await expect(svc.delete("public/never")).rejects.toThrow(AgentNotFoundError);
  });
});

// ─── resolveDepOrigins — fail-loud ───────────────────────────────

describe("AgentService — resolveDepOrigins fail-loud", () => {
  it("throws AgentUnresolvedDepError for unresolvable skill dep", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/missing"`;
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent", deps) });
    const skillRepo = new (await import("../src/persistence/skill.repository.js")).SkillRepository({
      db: orm.db,
    });
    svc = new AgentService({ repo, fetcher: fetcher.fetcher, siblings: { skills: skillRepo } });
    await expect(svc.install("file:/abs/agent")).rejects.toThrow(AgentUnresolvedDepError);
    expect(await repo.findById("public/agent")).toBeUndefined();
  });

  it("throws AgentUnresolvedDepError for unresolvable mcp dep", async () => {
    const deps = `dependencies:
  mcps:
    - "file:/abs/mcps/missing"`;
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent", deps) });
    const mcpRepo = new (await import("../src/persistence/mcp.repository.js")).McpRepository({
      db: orm.db,
    });
    svc = new AgentService({ repo, fetcher: fetcher.fetcher, siblings: { mcps: mcpRepo } });
    await expect(svc.install("file:/abs/agent")).rejects.toThrow(AgentUnresolvedDepError);
    expect(await repo.findById("public/agent")).toBeUndefined();
  });

  it("throws AgentUnresolvedDepError for unresolvable agent-to-agent dep", async () => {
    const deps = `dependencies:
  agents:
    - "file:/abs/agents/missing"`;
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent", deps) });
    await expect(svc.install("file:/abs/agent")).rejects.toThrow(AgentUnresolvedDepError);
    expect(await repo.findById("public/agent")).toBeUndefined();
  });

  it("succeeds when dep skill is present at the declared origin", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/helper"`;
    fetcher.set("file:/abs/agent", { "AGENTS.md": ANCHOR("agent", deps) });
    const skillRepo = new (await import("../src/persistence/skill.repository.js")).SkillRepository({
      db: orm.db,
    });
    const { SkillEntity } = await import("../src/domain/skill.entity.js");
    const skillEntity = SkillEntity.create(
      `---\nname: helper\ndescription: x\nversion: 1.0.0\n---\n# Body\n`,
      Origin.parse(safeNormalize("file:/abs/skills/helper")),
      "test",
    );
    await skillRepo.insert(
      skillEntity,
      new Map([
        [
          "SKILL.md",
          Buffer.from("---\nname: helper\ndescription: x\nversion: 1.0.0\n---\n# Body\n"),
        ],
      ]),
      { skills: [], mcps: [] },
    );
    svc = new AgentService({ repo, fetcher: fetcher.fetcher, siblings: { skills: skillRepo } });
    const a = await svc.install("file:/abs/agent");
    expect(a.fqn).toBe("public/agent");
  });
});
