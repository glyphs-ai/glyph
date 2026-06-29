import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { __Entity__IdSchema } from "../../src/domain/__entity-kebab__-id.js";

describe("__Entity__IdSchema", () => {
  it("accepts a canonical UUID", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(__Entity__IdSchema.parse(id)).toBe(id);
  });

  it("rejects an empty string", () => {
    expect(() => __Entity__IdSchema.parse("")).toThrow(ZodError);
  });

  it("rejects a non-UUID string", () => {
    expect(() => __Entity__IdSchema.parse("not-a-uuid")).toThrow(ZodError);
  });
});
