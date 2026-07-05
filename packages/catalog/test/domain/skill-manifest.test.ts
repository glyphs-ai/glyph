import { describe, expect, it } from "vitest";
import { SkillManifest } from "../../src/domain/skill-manifest.js";

describe("SkillManifest.create", () => {
  it("accepts compliant frontmatter and defaults scope to public", () => {
    const r = SkillManifest.create({ name: "tool-use", description: "d", version: "1.0.0" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.scope).toBe("public");
      expect(r.value.name).toBe("tool-use");
      expect(r.value.dependencyRefs).toEqual({ skills: [], mcps: [] });
    }
  });

  it("keeps an explicit scope", () => {
    const r = SkillManifest.create({
      name: "tool-use",
      scope: "com.acme",
      description: "d",
      version: "1.0.0",
    });
    expect(r.isOk() && r.value.scope).toBe("com.acme");
  });

  it("parses declared skill + mcp dep origins", () => {
    const r = SkillManifest.create({
      name: "tool-use",
      description: "d",
      version: "1.0.0",
      dependencies: { skills: ["file:/a"], mcps: ["file:/b.json"] },
    });
    expect(r.isOk() && r.value.dependencyRefs).toEqual({
      skills: ["file:/a"],
      mcps: ["file:/b.json"],
    });
  });

  it("rejects a missing version", () => {
    const r = SkillManifest.create({ name: "tool-use", description: "d" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.type).toBe("SkillManifestInvalid");
  });

  it("rejects an uppercase name", () => {
    const r = SkillManifest.create({ name: "ToolUse", description: "d", version: "1.0.0" });
    expect(r.isErr()).toBe(true);
  });
});
