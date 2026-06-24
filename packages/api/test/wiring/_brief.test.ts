import { describe, expect, it } from "vitest";
import { assertBriefShape } from "../../src/wiring/_brief.js";

class TestBriefError extends Error {
  override readonly name = "TestBriefError";
}

const LABEL = "Test target";

describe("assertBriefShape", () => {
  it("accepts a single-line brief at or under 200 trimmed characters", () => {
    expect(() => assertBriefShape("a tidy one-liner", LABEL, TestBriefError)).not.toThrow();
    expect(() => assertBriefShape("x".repeat(200), LABEL, TestBriefError)).not.toThrow();
    // Length is measured AFTER trim — surrounding whitespace doesn't
    // count against the 200 budget.
    expect(() => assertBriefShape(`  ${"x".repeat(200)}  `, LABEL, TestBriefError)).not.toThrow();
  });

  it("rejects a brief containing a newline with the single-line message", () => {
    expect(() => assertBriefShape("line one\nline two", LABEL, TestBriefError)).toThrow(
      TestBriefError,
    );
    expect(() => assertBriefShape("line one\nline two", LABEL, TestBriefError)).toThrow(
      "Test target brief must be a single line (no newline characters); pass long content via details",
    );
  });

  it("rejects a brief containing a carriage return", () => {
    expect(() => assertBriefShape("line one\rline two", LABEL, TestBriefError)).toThrow(
      TestBriefError,
    );
  });

  it("rejects a brief longer than 200 trimmed characters with the length message", () => {
    expect(() => assertBriefShape("x".repeat(201), LABEL, TestBriefError)).toThrow(TestBriefError);
    expect(() => assertBriefShape("x".repeat(201), LABEL, TestBriefError)).toThrow(
      "Test target brief must be 200 characters or fewer",
    );
  });

  it("checks the single-line rule before the length rule", () => {
    // A 201-char brief that also has a newline trips the single-line
    // guard first — the predicates run top-to-bottom.
    const offending = `${"x".repeat(100)}\n${"y".repeat(101)}`;
    expect(() => assertBriefShape(offending, LABEL, TestBriefError)).toThrow(
      /must be a single line/,
    );
  });

  it("throws the caller-supplied error class so instanceof routing stays stable", () => {
    try {
      assertBriefShape("bad\nbrief", LABEL, TestBriefError);
      throw new Error("expected assertBriefShape to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TestBriefError);
      expect((err as Error).name).toBe("TestBriefError");
    }
  });
});
