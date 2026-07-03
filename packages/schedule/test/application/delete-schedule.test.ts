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

describe("DeleteScheduleUseCase", () => {
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

  it("delete errs ScheduleEnabled when enabled", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const result = await h.module.deleteSchedule.execute({ id: VALID_UUIDS[0] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleEnabled");
  });

  it("delete errs ScheduleHasInFlight when handler reports in-flight", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    h.taskHandler.inFlightSet.add(VALID_UUIDS[0]);
    const result = await h.module.deleteSchedule.execute({ id: VALID_UUIDS[0] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleHasInFlight");
  });

  it("delete succeeds when disabled and no in-flight (returns deletedDispatchCount: 0)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    const result = (await h.module.deleteSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(result).toEqual({ deletedDispatchCount: 0 });
    expect((await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap()).toBeNull();
  });

  it("delete cascades historical dispatches via handler.deleteForSchedule and surfaces the count", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    h.taskHandler.deleteReturns.set(VALID_UUIDS[0], { deletedCount: 5 });
    const result = (await h.module.deleteSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(result).toEqual({ deletedDispatchCount: 5 });
    expect(h.taskHandler.deleteCalls).toEqual([VALID_UUIDS[0]]);
    expect((await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap()).toBeNull();
  });

  it("delete refuses if a manual run() races a fresh dispatch in between checks (TOCTOU)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    const sid = VALID_UUIDS[0];
    let hasInFlightCalls = 0;
    h.taskHandler.hasInFlightForSchedule = async () => {
      hasInFlightCalls += 1;
      return hasInFlightCalls > 1;
    };
    h.taskHandler.deleteReturns.set(sid, { deletedCount: 2 });
    const result = await h.module.deleteSchedule.execute({ id: sid });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleHasInFlight");
    expect(hasInFlightCalls).toBe(2);
    expect(h.taskHandler.deleteCalls).toEqual([sid]);
    expect((await h.module.getSchedule.execute({ id: sid }))._unsafeUnwrap()).not.toBeNull();
  });

  it("delete on missing id errs ScheduleNotFound", async () => {
    const result = await h.module.deleteSchedule.execute({
      id: "550e8400-e29b-41d4-a716-44665544aaaa",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
  });
});
