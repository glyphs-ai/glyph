import { describe, expect, it } from "vitest";
import { ScheduleEntity } from "../../../src/domain/schedule/schedule-entity.js";
import { ScheduleIdSchema } from "../../../src/domain/schedule/schedule-id.js";
import type { ScheduleTargetEnvelope } from "../../../src/domain/schedule/schedule-target.js";
import type { ScheduleTrigger } from "../../../src/domain/schedule/schedule-trigger.js";

const VALID_ID = ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
const FIXED_NOW = new Date("2026-05-01T00:00:00.000Z");

interface CreateScheduleOpts {
  readonly name: string;
  readonly trigger: ScheduleTrigger;
  readonly target: ScheduleTargetEnvelope;
  readonly enabled?: boolean;
}

function baseCreateOpts(over: Partial<CreateScheduleOpts> = {}): CreateScheduleOpts {
  return {
    name: "daily-report",
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent: "report-bot", brief: "Run the daily report" } },
    ...over,
  };
}

function create(over: Partial<CreateScheduleOpts> = {}): ScheduleEntity {
  return ScheduleEntity.create(baseCreateOpts(over), {
    id: VALID_ID,
    now: FIXED_NOW,
  })._unsafeUnwrap();
}

describe("ScheduleEntity.create", () => {
  it("creates a valid entity", () => {
    const e = create();
    expect(e.id).toBe(VALID_ID);
    expect(e.name).toBe("daily-report");
    expect(e.trigger.kind).toBe("cron");
    expect(e.target.kind).toBe("task");
    expect(e.target.data).toEqual({ agent: "report-bot", brief: "Run the daily report" });
    expect(e.enabled).toBe(true);
    expect(e.createdAt).toBe(FIXED_NOW.toISOString());
    expect(e.updatedAt).toBe(FIXED_NOW.toISOString());
    expect(e.lastFiredAt).toBeUndefined();
    expect(e.nextFireAt).toBeUndefined();
  });

  it("respects enabled=false in opts", () => {
    const e = create({ enabled: false });
    expect(e.enabled).toBe(false);
  });

  it("rejects empty name", () => {
    for (const name of ["", "   "]) {
      const result = ScheduleEntity.create(baseCreateOpts({ name }), {
        id: VALID_ID,
        now: FIXED_NOW,
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleName");
    }
  });

  it("rejects malformed cron", () => {
    const result = ScheduleEntity.create(
      baseCreateOpts({ trigger: { kind: "cron", expr: "garbage", tz: "UTC" } }),
      { id: VALID_ID, now: FIXED_NOW },
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidCronExpr");
  });

  it("rejects 6-field cron with the locked literal phrase", () => {
    const result = ScheduleEntity.create(
      baseCreateOpts({ trigger: { kind: "cron", expr: "*/5 * * * * *", tz: "UTC" } }),
      { id: VALID_ID, now: FIXED_NOW },
    );
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.type).toBe("InvalidCronExpr");
    if (err.type === "InvalidCronExpr")
      expect(err.reason).toContain("6-field cron not supported in v1");
  });

  it("rejects bad timezone", () => {
    const result = ScheduleEntity.create(
      baseCreateOpts({ trigger: { kind: "cron", expr: "0 9 * * *", tz: "Not/A_Zone" } }),
      { id: VALID_ID, now: FIXED_NOW },
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidTimezone");
  });

  it("stores target.data opaquely without inspecting it (handler owns shape)", () => {
    const e = create({ target: { kind: "task", data: { agent: "", brief: "" } } });
    expect(e.target.kind).toBe("task");
    expect(e.target.data).toEqual({ agent: "", brief: "" });
  });
});

describe("ScheduleEntity.withMetadata / withTrigger / withTarget", () => {
  const later = new Date("2026-05-02T00:00:00.000Z");

  it("withMetadata sets name and stamps updatedAt", () => {
    const e = create();
    const originalTrigger = e.trigger;
    const originalTarget = e.target;
    const originalEnabled = e.enabled;
    e.withMetadata({ name: "renamed" }, later)._unsafeUnwrap();
    expect(e.name).toBe("renamed");
    expect(e.updatedAt).toBe(later.toISOString());
    expect(e.createdAt).toBe(FIXED_NOW.toISOString());
    expect(e.enabled).toBe(originalEnabled);
    expect(e.trigger).toEqual(originalTrigger);
    expect(e.target).toEqual(originalTarget);
  });

  it("withMetadata sets enabled independently of name", () => {
    const e = create();
    const originalName = e.name;
    e.withMetadata({ enabled: false }, later)._unsafeUnwrap();
    expect(e.enabled).toBe(false);
    expect(e.name).toBe(originalName);
  });

  it("withMetadata rejects empty name (and leaves the entity unchanged)", () => {
    const e = create();
    const result = e.withMetadata({ name: "" }, later);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleName");
    expect(e.name).toBe("daily-report");
  });

  it("withTrigger replaces wholesale and stamps updatedAt", () => {
    const e = create();
    const originalTarget = e.target;
    e.withTrigger({ kind: "cron", expr: "0 10 * * *", tz: "UTC" }, later)._unsafeUnwrap();
    expect(e.trigger.expr).toBe("0 10 * * *");
    expect(e.updatedAt).toBe(later.toISOString());
    expect(e.target).toEqual(originalTarget);
  });

  it("withTrigger rejects bad cron expr", () => {
    const e = create();
    const result = e.withTrigger({ kind: "cron", expr: "garbage", tz: "UTC" }, FIXED_NOW);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidCronExpr");
  });

  it("withTarget replaces the envelope wholesale and stamps updatedAt", () => {
    const e = create();
    e.withTarget(
      { kind: "task", data: { agent: "other-bot", brief: "different" } },
      later,
    )._unsafeUnwrap();
    expect(e.target.kind).toBe("task");
    expect(e.target.data).toEqual({ agent: "other-bot", brief: "different" });
    expect(e.updatedAt).toBe(later.toISOString());
  });

  it("withTarget refuses to change the kind on an existing row", () => {
    const e = create();
    const result = e.withTarget({ kind: "workflow", data: { wfId: "wf-1" } }, later);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("TargetKindImmutable");
  });
});

describe("ScheduleEntity.withNextFireAt / recordFired", () => {
  it("withNextFireAt preserves lastFiredAt", () => {
    const e = create();
    e.recordFired("2026-05-01T09:00:00.000Z", "2026-05-02T09:00:00.000Z");
    e.withNextFireAt("2026-05-03T09:00:00.000Z");
    expect(e.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(e.nextFireAt).toBe("2026-05-03T09:00:00.000Z");
  });

  it("recordFired stamps lastFiredAt + nextFireAt without touching updatedAt", () => {
    const e = create();
    const originalUpdatedAt = e.updatedAt;
    e.recordFired("2026-05-01T09:00:00.000Z", "2026-05-02T09:00:00.000Z");
    expect(e.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(e.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
    expect(e.updatedAt).toBe(originalUpdatedAt);
  });
});
