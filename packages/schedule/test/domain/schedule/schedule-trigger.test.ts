import { describe, expect, it } from "vitest";
import {
  ScheduleTriggerSchema,
  validateTrigger,
} from "../../../src/domain/schedule/schedule-trigger.js";

describe("schedule-trigger.ScheduleTriggerSchema", () => {
  it("parses a structurally valid cron trigger", () => {
    const parsed = ScheduleTriggerSchema.parse({ kind: "cron", expr: "0 9 * * *", tz: "UTC" });
    expect(parsed).toEqual({ kind: "cron", expr: "0 9 * * *", tz: "UTC" });
  });

  it("rejects a non-'cron' kind literal", () => {
    expect(
      ScheduleTriggerSchema.safeParse({ kind: "interval", expr: "x", tz: "UTC" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      ScheduleTriggerSchema.safeParse({ kind: "cron", expr: "0 9 * * *", tz: "UTC", extra: 1 })
        .success,
    ).toBe(false);
  });

  it("enforces STRUCTURE only — a cron-illegal expr still parses (legality is validateTrigger's job)", () => {
    expect(
      ScheduleTriggerSchema.safeParse({ kind: "cron", expr: "not a cron", tz: "UTC" }).success,
    ).toBe(true);
  });
});

describe("schedule-trigger.validateTrigger", () => {
  it("accepts a legal cron expr + IANA tz", () => {
    expect(validateTrigger({ kind: "cron", expr: "0 9 * * 1-5", tz: "Asia/Shanghai" }).isOk()).toBe(
      true,
    );
  });

  it("errs InvalidCronExpr on a malformed expr", () => {
    const result = validateTrigger({ kind: "cron", expr: "not a cron", tz: "UTC" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidCronExpr");
  });

  it("errs InvalidTimezone on a bad tz (expr legal)", () => {
    const result = validateTrigger({ kind: "cron", expr: "0 9 * * *", tz: "Not/A_Zone" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidTimezone");
  });

  it("checks cron BEFORE tz — a bad expr AND bad tz surfaces InvalidCronExpr", () => {
    const result = validateTrigger({ kind: "cron", expr: "not a cron", tz: "Not/A_Zone" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidCronExpr");
  });
});
