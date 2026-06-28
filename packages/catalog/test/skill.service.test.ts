import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SkillFetcher, SkillService } from "../src/application/skill.service.js";
import {
  PlanStaleError,
  SkillNotFoundError,
  SkillOriginConflictError,
} from "../src/contract/skill.errors.js";
import { Origin } from "../src/domain/origin.js";
import { SkillEntity } from "../src/domain/skill.entity.js";
import { SkillFrontmatterError, SkillUnresolvedDepError } from "../src/domain/skill.errors.js";
import type { EntryFile } from "../src/fetcher/index.js";
import { safeNormalize } from "../src/fetcher/origin.js";
import { SkillRepository } from "../src/persistence/skill.repository.js";
import { bootstrapCatalogDb } from "./helpers/bootstrap.js";

function makeFetcher(): {
  fetcher: SkillFetcher;
  set: (origin: string, files: Record<string, string>) => void;
} {
  const trees = new Map<string, Map<string, Buffer>>();
  const fetcher: SkillFetcher = {
    async fetchAnchor(origin) {
      const tree = trees.get(safeNormalize(origin));
      if (tree === undefined) throw new Error(`fake fetcher: no fixture for ${origin}`);
      const anchor = tree.get("SKILL.md");
      if (anchor === undefined) throw new Error(`fake fetcher: no SKILL.md for ${origin}`);
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
let repo: SkillRepository;
let fetcher: ReturnType<typeof makeFetcher>;
let svc: SkillService;

beforeEach(async () => {
  orm = bootstrapCatalogDb();

  repo = new SkillRepository({ db: orm.db });
  fetcher = makeFetcher();
  svc = new SkillService({ repo, fetcher: fetcher.fetcher });
});

afterEach(async () => {
  try {
    orm.close();
  } catch {
    // already closed
  }
});

// ─── resolve ──────────────────────────────────────────────────

describe("SkillService.resolve", () => {
  it("returns a single-node plan for a leaf skill", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    expect(plan.conflict).toBeNull();
    expect(plan.node).not.toBeNull();
    expect(plan.node!.fqn).toBe("public/tool");
    expect(plan.node!.depsRefs.skills).toEqual([]);
    expect(plan.node!.depsRefs.mcps).toEqual([]);
  });

  it("captures the upstream version on the resolved node", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    expect(plan.node!.version).toBe("1.0.0");
  });

  it("surfaces dep refs (does NOT recurse — facade's job)", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/web-search"
  mcps:
    - "file:/abs/mcps/azure"`;
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool", deps) });
    const plan = await svc.resolve("file:/abs/tool");
    expect(plan.node!.depsRefs.skills).toEqual(["file:/abs/skills/web-search"]);
    expect(plan.node!.depsRefs.mcps).toEqual(["file:/abs/mcps/azure"]);
  });

  it("resolve only fetches the anchor — not sibling files", async () => {
    fetcher.set("file:/abs/tool", {
      "SKILL.md": ANCHOR("tool"),
      "siblings-shouldnt-be-touched.txt": "x",
    });
    // resolve only calls fetchAnchor; siblings are never read here.
    // (We don't have an introspection hook on the fake fetcher, so
    // we settle for "resolve succeeded with the right node shape".)
    const plan = await svc.resolve("file:/abs/tool");
    expect(plan.node!.fqn).toBe("public/tool");
    expect(plan.node!.anchorContent).toBe(ANCHOR("tool"));
  });

  it("surfaces fetch failures as conflict", async () => {
    const plan = await svc.resolve("file:/abs/never");
    expect(plan.node).toBeNull();
    expect(plan.conflict?.reason.kind).toBe("fetch-failed");
  });

  it("surfaces parse failures as conflict", async () => {
    fetcher.set("file:/abs/bad", { "SKILL.md": "no frontmatter" });
    const plan = await svc.resolve("file:/abs/bad");
    expect(plan.node).toBeNull();
    expect(plan.conflict?.reason.kind).toBe("parse-failed");
  });

  it("surfaces FQN-different-origin as conflict", async () => {
    fetcher.set("file:/abs/a", { "SKILL.md": ANCHOR("tool") });
    await svc.install("file:/abs/a");

    fetcher.set("file:/abs/b", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/b");
    expect(plan.conflict?.reason.kind).toBe("origin-conflict");
  });
});

// ─── install ──────────────────────────────────────────────────

describe("SkillService.install", () => {
  it("installs from origin string (resolve + install)", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool"), "extra.txt": "extra" });
    const s = await svc.install("file:/abs/tool");
    expect(s.fqn).toBe("public/tool");
    const got = await svc.get("public/tool");
    expect(got).not.toBeNull();
    const files = new Map<string, Buffer>();
    for await (const f of svc.streamFiles("public/tool")) files.set(f.relPath, f.content);
    expect(files.get("extra.txt")?.toString("utf8")).toBe("extra");
  });

  it("installs from a resolved plan node", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    expect(plan.node).not.toBeNull();
    const s = await svc.install(plan.node!);
    expect(s.fqn).toBe("public/tool");
  });

  it("throws SkillUnresolvedDepError when dep origin is not installed", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/child"`;
    fetcher.set("file:/abs/parent", { "SKILL.md": ANCHOR("parent", deps) });
    await expect(svc.install("file:/abs/parent")).rejects.toThrow(SkillUnresolvedDepError);
  });

  it("upserts content under same origin", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool"), "data.txt": "v1" });
    await svc.install("file:/abs/tool");
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool"), "data.txt": "v2" });
    await svc.install("file:/abs/tool");
    const files = new Map<string, Buffer>();
    for await (const f of svc.streamFiles("public/tool")) files.set(f.relPath, f.content);
    expect(files.get("data.txt")?.toString("utf8")).toBe("v2");
  });

  it("rejects same-FQN reinstall from different origin", async () => {
    fetcher.set("file:/abs/a", { "SKILL.md": ANCHOR("tool") });
    await svc.install("file:/abs/a");
    fetcher.set("file:/abs/b", { "SKILL.md": ANCHOR("tool") });
    await expect(svc.install("file:/abs/b")).rejects.toThrow(SkillOriginConflictError);
  });

  it("throws PlanStaleError when version changes between resolve and install", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool").replace("1.0.0", "2.0.0") });
    await expect(svc.install(plan.node!)).rejects.toThrow(PlanStaleError);
  });

  it("body-only upstream change does NOT trigger PlanStaleError (author contract)", async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    fetcher.set("file:/abs/tool", { "SKILL.md": `${ANCHOR("tool")}\nNew body content.\n` });
    const s = await svc.install(plan.node!);
    expect(s.fqn).toBe("public/tool");
  });

  it("frontmatter-edit-without-version-bump does NOT trigger PlanStaleError (author contract)", async () => {
    // Per the version-as-truth contract, even a frontmatter edit
    // (e.g. tweaking description) without a version bump is a
    // contributor bug — glyph treats it as a no-op rather than
    // racing on it.
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/tool");
    const tweaked = ANCHOR("tool").replace("description: x", "description: tweaked");
    fetcher.set("file:/abs/tool", { "SKILL.md": tweaked });
    const s = await svc.install(plan.node!);
    expect(s.fqn).toBe("public/tool");
    // The installed entity carries the freshly-fetched description —
    // the staleness check is the only gate, not a "reject if anything
    // changed" check.
    expect(s.description).toBe("tweaked");
  });

  it("install fails when fetched tree has no SKILL.md", async () => {
    fetcher.set("file:/abs/bad", { "SKILL.md": ANCHOR("tool") });
    const plan = await svc.resolve("file:/abs/bad");
    fetcher.set("file:/abs/bad", { "other.md": "x" });
    await expect(svc.install(plan.node!)).rejects.toThrow(SkillFrontmatterError);
  });
});

// ─── single-entity API ────────────────────────────────────────

describe("SkillService — single-entity API", () => {
  beforeEach(async () => {
    fetcher.set("file:/abs/tool", { "SKILL.md": ANCHOR("tool") });
    await svc.install("file:/abs/tool");
  });

  it("get returns SkillEntity entity", async () => {
    const s = await svc.get("public/tool");
    expect(s).toBeInstanceOf(SkillEntity);
    expect(s!.fqn).toBe("public/tool");
  });

  it("getByOrigin returns the entity matching origin", async () => {
    const s = await svc.getByOrigin("file:/abs/tool");
    expect(s!.fqn).toBe("public/tool");
  });

  it("getByOrigin normalizes the input so cross-separator file: lookups match", async () => {
    // Stored under canonical `file:///abs/tool` (normalized at
    // install time). A raw `file:/abs/tool` or backslash form must
    // still resolve to the same row.
    expect((await svc.getByOrigin("file:///abs/tool"))?.fqn).toBe("public/tool");
    expect((await svc.getByOrigin("file:/abs/tool/"))?.fqn).toBe("public/tool");
  });

  it("getByOrigin returns null without throwing on garbage input", async () => {
    expect(await svc.getByOrigin("not-a-valid-origin")).toBeNull();
    expect(await svc.getByOrigin("")).toBeNull();
  });

  it("has returns true / false", async () => {
    expect(await svc.has("public/tool")).toBe(true);
    expect(await svc.has("public/missing")).toBe(false);
  });

  it("list returns all installed skills", async () => {
    fetcher.set("file:/abs/other", { "SKILL.md": ANCHOR("other") });
    await svc.install("file:/abs/other");
    const all = await svc.list();
    expect(all.map((s) => s.fqn).sort()).toEqual(["public/other", "public/tool"]);
  });

  it("delete removes the skill", async () => {
    await svc.delete("public/tool");
    expect(await svc.has("public/tool")).toBe(false);
  });

  it("delete throws NotFound for missing skill", async () => {
    await expect(svc.delete("public/never")).rejects.toThrow(SkillNotFoundError);
  });
});

// ─── resolveDepOrigins — fail-loud ───────────────────────────────

describe("SkillService — resolveDepOrigins fail-loud", () => {
  it("throws SkillUnresolvedDepError for unresolvable skill dep", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/missing"`;
    fetcher.set("file:/abs/parent", { "SKILL.md": ANCHOR("parent", deps) });
    await expect(svc.install("file:/abs/parent")).rejects.toThrow(SkillUnresolvedDepError);
    expect(await repo.findById("public/parent")).toBeUndefined();
  });

  it("throws SkillUnresolvedDepError for unresolvable mcp dep", async () => {
    const deps = `dependencies:
  mcps:
    - "file:/abs/mcps/missing"`;
    fetcher.set("file:/abs/parent", { "SKILL.md": ANCHOR("parent", deps) });
    const mcpRepo = new (await import("../src/persistence/mcp.repository.js")).McpRepository({
      db: orm.db,
    });
    svc = new SkillService({ repo, fetcher: fetcher.fetcher, siblings: { mcps: mcpRepo } });
    await expect(svc.install("file:/abs/parent")).rejects.toThrow(SkillUnresolvedDepError);
    expect(await repo.findById("public/parent")).toBeUndefined();
  });

  it("succeeds when dep skill is present at the declared origin", async () => {
    const deps = `dependencies:
  skills:
    - "file:/abs/skills/child"`;
    fetcher.set("file:/abs/parent", { "SKILL.md": ANCHOR("parent", deps) });
    const childEntity = SkillEntity.create(
      `---\nname: child\ndescription: x\nversion: 1.0.0\n---\n# Body\n`,
      Origin.parse(safeNormalize("file:/abs/skills/child")),
      "test",
    );
    await repo.insert(
      childEntity,
      new Map([
        [
          "SKILL.md",
          Buffer.from("---\nname: child\ndescription: x\nversion: 1.0.0\n---\n# Body\n"),
        ],
      ]),
      { skills: [], mcps: [] },
    );
    const s = await svc.install("file:/abs/parent");
    expect(s.fqn).toBe("public/parent");
  });
});
