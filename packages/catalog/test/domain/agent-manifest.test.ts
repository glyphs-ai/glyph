import { describe, expect, it } from "vitest";
import { AgentManifest } from "../../src/domain/agent-manifest.js";

describe("AgentManifest.create", () => {
  it("accepts compliant frontmatter and defaults scope to public", () => {
    const r = AgentManifest.create({ name: "triage", description: "d", version: "1.0.0" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.scope).toBe("public");
      expect(r.value.dependencyRefs).toEqual({ skills: [], mcps: [], agents: [] });
    }
  });

  it("defaults description to an empty string when omitted", () => {
    const r = AgentManifest.create({ name: "triage", version: "1.0.0" });
    expect(r.isOk() && r.value.description).toBe("");
  });

  it("parses declared skill + mcp + agent dep origins", () => {
    const r = AgentManifest.create({
      name: "triage",
      description: "d",
      version: "1.0.0",
      dependencies: { skills: ["file:/s"], mcps: ["file:/m.json"], agents: ["file:/a"] },
    });
    expect(r.isOk() && r.value.dependencyRefs).toEqual({
      skills: ["file:/s"],
      mcps: ["file:/m.json"],
      agents: ["file:/a"],
    });
  });

  it("rejects a missing version", () => {
    const r = AgentManifest.create({ name: "triage", description: "d" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.type).toBe("AgentManifestInvalid");
  });
});
