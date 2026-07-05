import { describe, expect, it } from "vitest";
import { nextRuns, validateCron, validateTimezone } from "../../../src/domain/schedule/cron.js";

function expectErrType(result: ReturnType<typeof validateCron>, type: string): void {
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().type).toBe(type);
}

describe("cron.assertValidCronExpr", () => {
  it("accepts a standard 5-field expression", () => {
    expect(validateCron("*/5 * * * *").isOk()).toBe(true);
    expect(validateCron("0 9 * * 1-5").isOk()).toBe(true);
    expect(validateCron("0 0 1 1 *").isOk()).toBe(true);
  });

  it("rejects 6-field expressions with the locked literal phrase", () => {
    const result = validateCron("*/5 * * * * *");
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.type).toBe("InvalidCronExpr");
    expect(err.reason).toContain("6-field cron not supported in v1");
  });

  it("rejects garbage", () => {
    expectErrType(validateCron("not a cron"), "InvalidCronExpr");
    expectErrType(validateCron(""), "InvalidCronExpr");
    expectErrType(validateCron("* * * *"), "InvalidCronExpr");
  });

  it("rejects 4-field as not 5-field (covered by FIVE_FIELD_RE)", () => {
    expectErrType(validateCron("* * * *"), "InvalidCronExpr");
  });
});

describe("cron.assertValidTimezone", () => {
  it("accepts UTC", () => {
    expect(validateTimezone("UTC").isOk()).toBe(true);
  });

  it("accepts named IANA zones", () => {
    expect(validateTimezone("Asia/Shanghai").isOk()).toBe(true);
    expect(validateTimezone("America/New_York").isOk()).toBe(true);
    expect(validateTimezone("Europe/London").isOk()).toBe(true);
  });

  it("rejects unknown zones", () => {
    const result = validateTimezone("Not/A_Zone");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidTimezone");
  });
});

describe("cron.nextRuns", () => {
  it("returns n ISO timestamps in ascending order", () => {
    const after = new Date("2026-01-01T00:00:00Z");
    const runs = nextRuns("0 * * * *", "UTC", after, 3);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toBe("2026-01-01T01:00:00.000Z");
    expect(runs[1]).toBe("2026-01-01T02:00:00.000Z");
    expect(runs[2]).toBe("2026-01-01T03:00:00.000Z");
  });

  it("advances the cursor on each iteration (no duplicate first fire)", () => {
    const after = new Date("2026-01-01T00:00:00Z");
    const runs = nextRuns("0 9 * * *", "UTC", after, 3);
    expect(new Set(runs).size).toBe(3);
  });

  it("honours the timezone when computing the UTC instant", () => {
    const after = new Date("2026-01-01T01:00:00Z");
    const [first] = nextRuns("0 9 * * *", "Asia/Tokyo", after, 1);
    expect(first).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns fewer results if cron is exhausted (defensive; shouldn't happen for standard exprs)", () => {
    const after = new Date("2030-01-01T00:00:00Z");
    const runs = nextRuns("0 0 * * *", "UTC", after, 5);
    expect(runs.length).toBeGreaterThan(0);
  });
});
