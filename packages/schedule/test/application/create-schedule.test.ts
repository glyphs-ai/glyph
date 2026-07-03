import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateScheduleRequest } from "../../src/application/create-schedule.js";
import {
  fixedRandomUUID,
  makeScheduleTestHandle,
  type ScheduleTestHandle,
  VALID_UUIDS,
} from "./schedule-fixture.js";

function baseCreateOpts(over: Partial<CreateScheduleRequest> = {}): CreateScheduleRequest {
  return {
    name: "daily-report",
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent: "report-bot", brief: "Run the daily report" } },
    ...over,
  };
}

describe("CreateScheduleUseCase", () => {
  let h: ScheduleTestHandle;

  beforeEach(async () => {
    h = await makeScheduleTestHandle({
      initialNow: new Date("2026-05-01T00:00:00.000Z"),
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
  });

  afterEach(async () => {
    await h.close();
  });

  it("create populates id, timestamps, enabled default, and next_fire_at", async () => {
    const s = (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    expect(s.id).toBe(VALID_UUIDS[0]);
    expect(s.name).toBe("daily-report");
    expect(s.enabled).toBe(true);
    expect(s.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(s.updatedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(s.lastFiredAt).toBeUndefined();
    expect(s.nextFireAt).toBe("2026-05-01T09:00:00.000Z");
    expect(s.target.kind).toBe("task");
    expect(s.target.data).toEqual({ agent: "report-bot", brief: "Run the daily report" });
  });

  it("create with enabled=false does NOT pre-arm next_fire_at", async () => {
    const s = (
      await h.module.createSchedule.execute(baseCreateOpts({ enabled: false }))
    )._unsafeUnwrap();
    expect(s.enabled).toBe(false);
    expect(s.nextFireAt).toBeUndefined();
  });

  it("create routes through handler.validate (called BEFORE entity construction)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    expect(h.taskHandler.validateCalls).toHaveLength(1);
    expect(h.taskHandler.validateCalls[0]?.data).toEqual({
      agent: "report-bot",
      brief: "Run the daily report",
    });
    expect(h.taskHandler.validateCalls[0]?.changedKeys).toBeUndefined();
  });

  it("create runs schedule-level invariants BEFORE handler.validate", async () => {
    let validateCalled = false;
    h.taskHandler.validate = async () => {
      validateCalled = true;
      throw new Error("fake catalog error");
    };
    const result = await h.module.createSchedule.execute(baseCreateOpts({ name: "" }));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleName");
    expect(validateCalled).toBe(false);
  });

  it("create propagates handler.validate rejections (e.g. catalog miss)", async () => {
    h.taskHandler.validate = async () => {
      throw new Error("agent not found");
    };
    const result = await h.module.createSchedule.execute(baseCreateOpts());
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.type).toBe("TargetValidationFailed");
    if (err.type === "TargetValidationFailed")
      expect(err.cause).toEqual(new Error("agent not found"));
  });
});
