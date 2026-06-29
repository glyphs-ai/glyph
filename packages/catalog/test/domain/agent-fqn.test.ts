import { describe, expect, it } from "vitest";
import {
  AgentFqn,
  AgentFqnSchema,
  AgentNameSchema,
  AgentScopeSchema,
} from "../../src/domain/agent-fqn.js";

describe("AgentFqnSchema", () => {
  it("accepts a lowercase <scope>/<name>", () => {
    expect(AgentFqnSchema.safeParse("public/triage").success).toBe(true);
  });

  it("allows reverse-DNS dots in the scope", () => {
    expect(AgentFqnSchema.safeParse("com.acme/triage").success).toBe(true);
  });

  it("rejects a bare name with no scope", () => {
    expect(AgentFqnSchema.safeParse("triage").success).toBe(false);
  });

  it("rejects uppercase segments", () => {
    expect(AgentFqnSchema.safeParse("Public/Triage").success).toBe(false);
  });

  it("rejects more than one '/'", () => {
    expect(AgentFqnSchema.safeParse("a/b/c").success).toBe(false);
  });
});

describe("AgentFqn.create", () => {
  it("composes a branded fqn from validated segments", () => {
    const scope = AgentScopeSchema.parse("public");
    const name = AgentNameSchema.parse("triage");
    expect(AgentFqn.create(scope, name)).toBe("public/triage");
  });
});
