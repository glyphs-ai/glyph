import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCatalogRuntime,
  type CatalogRuntime,
  CatalogService,
} from "../../src/facade/catalog-service.js";
import { bootstrapCatalogDb } from "../helpers/bootstrap.js";

let orm: ReturnType<typeof bootstrapCatalogDb>;
let runtime: CatalogRuntime;
let mgr: CatalogService;
let scratch: string;

beforeEach(async () => {
  orm = bootstrapCatalogDb();
  runtime = buildCatalogRuntime({ db: orm.db });
  mgr = new CatalogService({ runtime });
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-install-flow-"));
});

afterEach(async () => {
  try {
    orm.close();
  } catch {
    // already closed
  }
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function fileUri(absPath: string): string {
  // Forward-slash normalisation: on Windows `path.join` produces
  // backslashes which YAML's double-quoted scalars interpret as escape
  // sequences (`\U`, `\L`, …). Forward slashes are an alternative path
  // separator on Windows and survive YAML round-tripping verbatim.
  return `file:${absPath.split(path.sep).join("/")}`;
}

const AGENT_ANCHOR = (name: string, deps = "") => `---
name: ${name}
description: x
version: 1.0.0
${deps}
---
# Body
`;

const SKILL_ANCHOR = (name: string, deps = "") => `---
name: ${name}
description: x
version: 1.0.0
${deps}
---
# Body
`;

const MCP_FIXTURE = (name: string) =>
  JSON.stringify({ _meta: { name }, command: "node", args: ["server.js"] });

describe("install flow with file: origins pointing at the anchor file", () => {
  it("cascade-installs an agent dep declared via the AGENTS.md file URI", async () => {
    const engineerDir = path.join(scratch, "engineer");
    await mkdir(engineerDir, { recursive: true });
    const engineerAnchor = path.join(engineerDir, "AGENTS.md");
    await writeFile(engineerAnchor, AGENT_ANCHOR("engineer-test"), "utf8");

    const coordDir = path.join(scratch, "coordinator");
    await mkdir(coordDir, { recursive: true });
    const coordAnchor = path.join(coordDir, "AGENTS.md");
    await writeFile(
      coordAnchor,
      AGENT_ANCHOR(
        "coordinator-test",
        `dependencies:\n  agents:\n    - "${fileUri(engineerAnchor)}"`,
      ),
      "utf8",
    );

    const result = await mgr.installAgent(fileUri(coordDir));

    expect(result.failed).toEqual([]);
    expect(result.conflicts).toEqual([]);
    const fqns = result.installed.map((n) => `${n.kind}:${n.fqn}`);
    expect(fqns).toContain("agent:public/engineer-test");
    expect(fqns).toContain("agent:public/coordinator-test");

    const persistedCoord = await mgr.getAgent("public/coordinator-test");
    expect(persistedCoord).not.toBeNull();
    const agentDeps = persistedCoord?.dependencies?.agents ?? [];
    expect(agentDeps.map((d) => d.fqn)).toContain("public/engineer-test");
  });

  it("surfaces a fetch-failed agent dep on the install result without aborting the root install", async () => {
    const coordDir = path.join(scratch, "coordinator");
    await mkdir(coordDir, { recursive: true });
    await writeFile(
      path.join(coordDir, "AGENTS.md"),
      AGENT_ANCHOR(
        "coordinator-test",
        `dependencies:\n  agents:\n    - "file:/nonexistent/glyph-install-flow/missing/AGENTS.md"`,
      ),
      "utf8",
    );

    const result = await mgr.installAgent(fileUri(coordDir));

    const coordInstalled = result.installed.find((n) => n.fqn === "public/coordinator-test");
    expect(coordInstalled).not.toBeUndefined();
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.kind).toBe("agent");
    expect(conflict?.origin).toBe("file:/nonexistent/glyph-install-flow/missing/AGENTS.md");
    expect(conflict?.reason.kind).toBe("fetch-failed");

    const persistedCoord = await mgr.getAgent("public/coordinator-test");
    const agentDeps = persistedCoord?.dependencies?.agents ?? [];
    expect(agentDeps).toEqual([]);
  });

  it("surfaces a fetch-failed skill dep with the same conflict shape", async () => {
    const coordDir = path.join(scratch, "coordinator-skill");
    await mkdir(coordDir, { recursive: true });
    await writeFile(
      path.join(coordDir, "AGENTS.md"),
      AGENT_ANCHOR(
        "coordinator-test-2",
        `dependencies:\n  skills:\n    - "file:/nonexistent/glyph-install-flow/missing-skill/"`,
      ),
      "utf8",
    );

    const result = await mgr.installAgent(fileUri(coordDir));

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("skill");
    expect(result.conflicts[0]?.reason.kind).toBe("fetch-failed");
  });

  it("surfaces a fetch-failed mcp dep with the same conflict shape", async () => {
    const coordDir = path.join(scratch, "coordinator-mcp");
    await mkdir(coordDir, { recursive: true });
    await writeFile(
      path.join(coordDir, "AGENTS.md"),
      AGENT_ANCHOR(
        "coordinator-test-3",
        `dependencies:\n  mcps:\n    - "file:/nonexistent/glyph-install-flow/missing-mcp.json"`,
      ),
      "utf8",
    );

    const result = await mgr.installAgent(fileUri(coordDir));

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("mcp");
    expect(result.conflicts[0]?.reason.kind).toBe("fetch-failed");
  });

  it("cascade-installs a skill dep declared via the SKILL.md file URI", async () => {
    const toolDir = path.join(scratch, "tool");
    await mkdir(toolDir, { recursive: true });
    const toolAnchor = path.join(toolDir, "SKILL.md");
    await writeFile(toolAnchor, SKILL_ANCHOR("tool-test"), "utf8");

    const parentDir = path.join(scratch, "parent-skill");
    await mkdir(parentDir, { recursive: true });
    await writeFile(
      path.join(parentDir, "SKILL.md"),
      SKILL_ANCHOR("parent-test", `dependencies:\n  skills:\n    - "${fileUri(toolAnchor)}"`),
      "utf8",
    );

    const result = await mgr.installSkill(fileUri(parentDir));

    expect(result.failed).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.installed.map((n) => n.fqn)).toContain("public/tool-test");
    expect(result.installed.map((n) => n.fqn)).toContain("public/parent-test");
  });

  it("cascade-installs an mcp dep when origin points at the .json file", async () => {
    const mcpsDir = path.join(scratch, "mcps");
    await mkdir(mcpsDir, { recursive: true });
    const mcpFile = path.join(mcpsDir, "vendor-x.json");
    await writeFile(mcpFile, MCP_FIXTURE("vendor/x"), "utf8");

    const skillDir = path.join(scratch, "skill-with-mcp");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      SKILL_ANCHOR("uses-mcp", `dependencies:\n  mcps:\n    - "${fileUri(mcpFile)}"`),
      "utf8",
    );

    const result = await mgr.installSkill(fileUri(skillDir));

    expect(result.failed).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.installed.map((n) => `${n.kind}:${n.fqn}`)).toContain("mcp:vendor/x");
    expect(result.installed.map((n) => `${n.kind}:${n.fqn}`)).toContain("skill:public/uses-mcp");
  });
});
