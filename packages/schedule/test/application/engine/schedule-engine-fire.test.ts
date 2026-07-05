import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateScheduleRequest } from "../../../src/application/create-schedule.js";
import {
  fixedRandomUUID,
  makeScheduleTestHandle,
  type ScheduleTestHandle,
  VALID_UUIDS,
} from "../schedule-fixture.js";

function baseCreateOpts(over: Partial<CreateScheduleRequest> = {}): CreateScheduleRequest {
  return {
    name: "daily-report",
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent: "report-bot", brief: "Run the daily report" } },
    ...over,
  };
}

describe("ScheduleEngine — automated fire", () => {
  let h: ScheduleTestHandle;
  const maxTimerDelayMs = 2_147_483_647;

  beforeEach(async () => {
    vi.useFakeTimers();
    h = await makeScheduleTestHandle({
      initialNow: new Date("2026-05-01T08:59:00.000Z"),
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
  });

  afterEach(async () => {
    await h.close();
    vi.useRealTimers();
  });

  it("automated fire skips and warns when handler.hasInFlightForSchedule reports true", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.taskHandler.inFlightSet.add(VALID_UUIDS[0]);
    h.setNow(new Date("2026-05-01T09:00:00.500Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.taskHandler.dispatchCalls).toHaveLength(0);
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBeUndefined();
    expect(after?.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
  });

  it("automated fire dispatches when no in-flight; records fire + re-arms", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
    expect(h.taskHandler.dispatchCalls[0]?.scheduleId).toBe(VALID_UUIDS[0]);
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after?.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
  });

  it("chunks automated timers that exceed Node's maximum setTimeout delay", async () => {
    h.setNow(new Date("2026-01-02T00:00:00.000Z"));
    (
      await h.module.createSchedule.execute(
        baseCreateOpts({ trigger: { kind: "cron", expr: "0 0 1 * *", tz: "UTC" } }),
      )
    )._unsafeUnwrap();
    h.setNow(new Date(Date.parse("2026-01-02T00:00:00.000Z") + maxTimerDelayMs));
    await vi.advanceTimersByTimeAsync(maxTimerDelayMs);
    expect(h.taskHandler.dispatchCalls).toHaveLength(0);
    h.setNow(new Date("2026-02-01T00:00:00.000Z"));
    const remainingDelayMs =
      Date.parse("2026-02-01T00:00:00.000Z") -
      Date.parse("2026-01-02T00:00:00.000Z") -
      maxTimerDelayMs;
    await vi.advanceTimersByTimeAsync(remainingDelayMs);
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });
});
