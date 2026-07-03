import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateScheduleId, parseScheduleId } from "../../../src/domain/schedule/schedule-id.js";

describe("validate.assertValidScheduleId", () => {
  it("accepts a real UUID v4", () => {
    expect(parseScheduleId(randomUUID()).isOk()).toBe(true);
  });

  it("accepts known UUID v4 literals", () => {
    expect(parseScheduleId("550e8400-e29b-41d4-a716-446655440000").isOk()).toBe(true);
  });

  it("rejects YYYYMMDD-xxxxxxxx form (used by task/session/workflow)", () => {
    const result = parseScheduleId("20260101-deadbeef");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleId");
  });

  it("rejects empty / non-string / arbitrary strings", () => {
    for (const id of ["", "abc", undefined, 123] as const) {
      const result = parseScheduleId(id);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleId");
    }
  });

  it("rejects UUID v1 (version digit != 4)", () => {
    const result = parseScheduleId("550e8400-e29b-11d4-a716-446655440000");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleId");
  });
});

describe("validate.generateScheduleId", () => {
  it("uses node:crypto by default", () => {
    expect(parseScheduleId(generateScheduleId()).isOk()).toBe(true);
  });

  it("honours the injected randomUUIDFn (deterministic-test seam)", () => {
    const fixed = "550e8400-e29b-41d4-a716-446655440000";
    const id = generateScheduleId(() => fixed);
    expect(id).toBe(fixed);
  });
});
