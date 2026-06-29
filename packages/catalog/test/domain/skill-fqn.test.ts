import { describe, expect, it } from "vitest";
import {
  SkillFqn,
  SkillFqnSchema,
  SkillNameSchema,
  SkillScopeSchema,
} from "../../src/domain/skill-fqn.js";

describe("SkillFqnSchema", () => {
  it("accepts a lowercase <scope>/<name>", () => {
    expect(SkillFqnSchema.safeParse("public/tool-use").success).toBe(true);
  });

  it("allows reverse-DNS dots in the scope", () => {
    expect(SkillFqnSchema.safeParse("com.acme/tool-use").success).toBe(true);
  });

  it("rejects a bare name with no scope", () => {
    expect(SkillFqnSchema.safeParse("tool-use").success).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(SkillFqnSchema.safeParse("Public/Tool").success).toBe(false);
  });

  it("rejects more than one '/'", () => {
    expect(SkillFqnSchema.safeParse("a/b/c").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(SkillFqnSchema.safeParse("").success).toBe(false);
  });
});

describe("SkillScopeSchema", () => {
  it("defaults to 'public' when omitted", () => {
    expect(SkillScopeSchema.parse(undefined)).toBe("public");
  });
});

describe("SkillFqn.create", () => {
  it("composes a branded fqn from validated segments", () => {
    const scope = SkillScopeSchema.parse("public");
    const name = SkillNameSchema.parse("tool-use");
    expect(SkillFqn.create(scope, name)).toBe("public/tool-use");
  });
});
