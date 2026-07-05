import { describe, expect, it } from "vitest";
import { McpFqnSchema } from "../../src/domain/mcp-fqn.js";

describe("McpFqnSchema", () => {
  it("accepts a <namespace>/<short> spec name", () => {
    expect(McpFqnSchema.safeParse("azure/mcp").success).toBe(true);
  });

  it("rejects whitespace", () => {
    expect(McpFqnSchema.safeParse("azure /mcp").success).toBe(false);
  });

  it("rejects control characters and backslashes", () => {
    expect(McpFqnSchema.safeParse("azure\\mcp").success).toBe(false);
    expect(McpFqnSchema.safeParse("azure/\u0001mcp").success).toBe(false);
  });

  it("rejects more than one '/'", () => {
    expect(McpFqnSchema.safeParse("a/b/c").success).toBe(false);
  });

  it("rejects '.' or '..' segments", () => {
    expect(McpFqnSchema.safeParse("./mcp").success).toBe(false);
    expect(McpFqnSchema.safeParse("azure/..").success).toBe(false);
  });

  it("rejects an over-long name (>200 chars)", () => {
    const long = `azure/${"m".repeat(200)}`;
    expect(McpFqnSchema.safeParse(long).success).toBe(false);
  });

  it("allows uppercase (mcp grammar is not kebab-restricted)", () => {
    expect(McpFqnSchema.safeParse("Azure/MCP").success).toBe(true);
  });
});
