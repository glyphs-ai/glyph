import { describe, expect, it } from "vitest";
import { truncateBrief } from "../../src/utils/brief";

describe("truncateBrief", () => {
  it("returns the input unchanged when it fits the cap", () => {
    expect(truncateBrief("short brief", 80)).toBe("short brief");
  });

  it("returns the input unchanged when length equals the cap exactly", () => {
    const s = "a".repeat(80);
    expect(truncateBrief(s, 80)).toBe(s);
  });

  it("appends an ellipsis when the input exceeds the cap", () => {
    const s = "a".repeat(120);
    const out = truncateBrief(s, 80);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("cuts on a word boundary when whitespace sits inside the tail window", () => {
    // 60 chars then "boundary stop" → with cap 50 we expect the cut
    // to roll back to the last whitespace inside the tail-quarter so
    // the visible string ends on a word.
    const text =
      "Iteration one engineer attempts to land the fix boundary stop continues afterwards";
    const out = truncateBrief(text, 50);
    expect(out.endsWith("…")).toBe(true);
    // The visible suffix immediately before the ellipsis must NOT be
    // mid-word (no trailing alphanumerics + ellipsis sitting on a
    // partial word).
    expect(out).not.toMatch(/[A-Za-z]{4,}\u2026$/);
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it("falls back to a hard char cut when no whitespace sits in the tail window", () => {
    // A single long token (e.g. URL-style) wider than the cap has no
    // whitespace to roll back to inside the tail quarter.
    const url = `https://example.com/${"a".repeat(120)}`;
    const out = truncateBrief(url, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it("uses default cap (80) when maxChars is omitted", () => {
    const s = "x".repeat(200);
    const out = truncateBrief(s);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns an empty string for empty input", () => {
    expect(truncateBrief("", 80)).toBe("");
  });

  it("returns an empty string for maxChars <= 0", () => {
    expect(truncateBrief("anything", 0)).toBe("");
    expect(truncateBrief("anything", -3)).toBe("");
  });

  it("returns just the ellipsis when maxChars=1 and input is longer", () => {
    // Budget is 0 after reserving for the ellipsis, so the only
    // possible glyph is the ellipsis itself.
    expect(truncateBrief("anything", 1)).toBe("…");
  });

  it("coerces non-string inputs to an empty string (defensive)", () => {
    expect(truncateBrief(undefined as unknown as string, 80)).toBe("");
    expect(truncateBrief(null as unknown as string, 80)).toBe("");
    expect(truncateBrief(42 as unknown as string, 80)).toBe("");
  });

  it("does not introduce a trailing whitespace before the ellipsis", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const out = truncateBrief(text, 30);
    expect(out).not.toMatch(/\s\u2026$/);
    expect(out.endsWith("…")).toBe(true);
  });
});
