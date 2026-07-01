import { describe, expect, it } from "vitest";
import { TaskIdSchema } from "../../src/domain/task-id.js";

describe("TaskIdSchema", () => {
  it("accepts a canonical YYYYMMDD-xxxxxxxx id", () => {
    expect(TaskIdSchema.safeParse("20260508-9dfbdf05").success).toBe(true);
  });

  it.each([
    ["wrong separator", "20260508_9dfbdf05"],
    ["uppercase hex", "20260508-9DFBDF05"],
    ["short suffix", "20260508-9dfbdf0"],
    ["long suffix", "20260508-9dfbdf050"],
    ["short date", "2026058-9dfbdf05"],
    ["empty", ""],
    ["path traversal", "../../etc-passwd"],
  ])("rejects %s (%s)", (_label, value) => {
    expect(TaskIdSchema.safeParse(value).success).toBe(false);
  });

  it("round-trips a parsed value", () => {
    expect(TaskIdSchema.parse("20260508-9dfbdf05")).toBe("20260508-9dfbdf05");
  });
});
