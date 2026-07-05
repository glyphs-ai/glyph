import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { WorkspaceNameSchema } from "../../src/domain/workspace-name.js";

describe("WorkspaceNameSchema", () => {
  it("accepts a plain non-empty name", () => {
    expect(WorkspaceNameSchema.parse("Demo")).toBe("Demo");
  });

  it("accepts unicode and emoji", () => {
    expect(WorkspaceNameSchema.parse("项目 ✓")).toBe("项目 ✓");
  });

  it("accepts a 64-char name (at the limit)", () => {
    const s = "x".repeat(64);
    expect(WorkspaceNameSchema.parse(s)).toBe(s);
  });

  it("rejects an empty string", () => {
    expect(() => WorkspaceNameSchema.parse("")).toThrow(ZodError);
  });

  it("rejects whitespace-only", () => {
    expect(() => WorkspaceNameSchema.parse("   ")).toThrow(ZodError);
  });

  it("rejects a name over 64 chars", () => {
    expect(() => WorkspaceNameSchema.parse("x".repeat(65))).toThrow(ZodError);
  });

  it("rejects ASCII control characters", () => {
    expect(() => WorkspaceNameSchema.parse("foo\u0001bar")).toThrow(ZodError);
    expect(() => WorkspaceNameSchema.parse("foo\nbar")).toThrow(ZodError);
    expect(() => WorkspaceNameSchema.parse("foo\u007Fbar")).toThrow(ZodError);
  });

  it("rejects non-string input", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing schema rejection of non-string inputs.
    expect(() => WorkspaceNameSchema.parse(null as any)).toThrow(ZodError);
  });
});
