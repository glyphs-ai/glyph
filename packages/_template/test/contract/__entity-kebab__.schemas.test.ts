import { describe, expect, it } from "vitest";
import {
  __Entity__IdSchema,
  __Entity__NameSchema,
  Create__Entity__RequestSchema,
} from "../../src/contract/__entity-kebab__.schemas.js";

// Contract-layer unit test: pins the zod schemas' accept/reject behaviour.
// Imports only from `contract/` (a single src subdir), so per the
// test-layout convention this lives in `test/contract/`.

describe("__Entity__IdSchema", () => {
  it("accepts 1–64 chars of [a-zA-Z0-9_-]", () => {
    expect(__Entity__IdSchema.safeParse("abc_DEF-123").success).toBe(true);
    expect(__Entity__IdSchema.safeParse("a").success).toBe(true);
  });

  it("rejects empty, over-long, or out-of-grammar ids", () => {
    expect(__Entity__IdSchema.safeParse("").success).toBe(false);
    expect(__Entity__IdSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(__Entity__IdSchema.safeParse("has spaces").success).toBe(false);
  });
});

describe("__Entity__NameSchema", () => {
  it("accepts non-empty, in-range names", () => {
    expect(__Entity__NameSchema.safeParse("My __Entity__").success).toBe(true);
    expect(__Entity__NameSchema.safeParse("a".repeat(64)).success).toBe(true);
  });

  it("rejects empty / whitespace-only / over-long names", () => {
    expect(__Entity__NameSchema.safeParse("").success).toBe(false);
    expect(__Entity__NameSchema.safeParse("   ").success).toBe(false);
    expect(__Entity__NameSchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("Create__Entity__RequestSchema", () => {
  it("accepts a valid { name }", () => {
    expect(Create__Entity__RequestSchema.safeParse({ name: "Valid" }).success).toBe(true);
  });

  it("rejects a missing or invalid name (composed from __Entity__NameSchema)", () => {
    expect(Create__Entity__RequestSchema.safeParse({}).success).toBe(false);
    expect(Create__Entity__RequestSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    expect(Create__Entity__RequestSchema.safeParse({ name: "X", extra: 1 }).success).toBe(false);
  });
});
