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

describe("GetScheduleUseCase", () => {
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

  it("get returns the wire DTO; null when missing", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const got = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(got?.name).toBe("daily-report");
    const missing = (
      await h.module.getSchedule.execute({ id: "550e8400-e29b-41d4-a716-44665544aaaa" })
    )._unsafeUnwrap();
    expect(missing).toBeNull();
  });

  it("get with matching expectedKind returns the row; mismatch reads as null", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const matched = (
      await h.module.getSchedule.execute({ id: VALID_UUIDS[0], expectedKind: "task" })
    )._unsafeUnwrap();
    expect(matched?.name).toBe("daily-report");
    const mismatched = (
      await h.module.getSchedule.execute({ id: VALID_UUIDS[0], expectedKind: "workflow" })
    )._unsafeUnwrap();
    expect(mismatched).toBeNull();
  });
});
