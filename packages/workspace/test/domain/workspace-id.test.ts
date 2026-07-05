import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { WorkspaceIdSchema } from "../../src/domain/workspace-id.js";

describe("WorkspaceIdSchema", () => {
  it("accepts a canonical lowercase UUID", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(WorkspaceIdSchema.parse(id)).toBe(id);
  });

  it("accepts uppercase UUIDs (regex is case-insensitive)", () => {
    const id = "ABCDEF12-3456-4789-ABCD-EF1234567890";
    expect(WorkspaceIdSchema.parse(id)).toBe(id);
  });

  it("rejects an empty string", () => {
    expect(() => WorkspaceIdSchema.parse("")).toThrow(ZodError);
  });

  it("rejects a non-UUID string", () => {
    expect(() => WorkspaceIdSchema.parse("not-a-uuid")).toThrow(ZodError);
  });

  it("rejects a UUID without dashes", () => {
    expect(() => WorkspaceIdSchema.parse("11111111111141118111111111111111")).toThrow(ZodError);
  });

  it("rejects an over-long string that contains a valid UUID prefix", () => {
    expect(() => WorkspaceIdSchema.parse("11111111-1111-4111-8111-111111111111-extra")).toThrow(
      ZodError,
    );
  });

  it("rejects a non-string input", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing schema rejection of non-string inputs.
    expect(() => WorkspaceIdSchema.parse(123 as any)).toThrow(ZodError);
  });
});
