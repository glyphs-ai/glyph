import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { __Entity__NameSchema } from "../../src/domain/__entity-kebab__-name.js";

describe("__Entity__NameSchema", () => {
  it("accepts a non-empty name", () => {
    expect(__Entity__NameSchema.parse("Demo")).toBe("Demo");
  });

  it("rejects an empty string", () => {
    expect(() => __Entity__NameSchema.parse("")).toThrow(ZodError);
  });

  it("rejects a whitespace-only name", () => {
    expect(() => __Entity__NameSchema.parse("   ")).toThrow(ZodError);
  });
});
