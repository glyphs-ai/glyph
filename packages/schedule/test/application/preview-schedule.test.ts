import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeScheduleTestHandle, type ScheduleTestHandle } from "./schedule-fixture.js";

describe("PreviewScheduleUseCase", () => {
  let h: ScheduleTestHandle;

  beforeEach(async () => {
    h = await makeScheduleTestHandle({ initialNow: new Date("2026-05-01T00:00:00.000Z") });
  });

  afterEach(async () => {
    await h.close();
  });

  it("returns 3 ISO timestamps in ascending order (default n)", async () => {
    const result = (
      await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC" })
    )._unsafeUnwrap();
    expect(result.nextRuns).toHaveLength(3);
    expect(result.nextRuns[0]).toBe("2026-05-01T09:00:00.000Z");
    expect(result.nextRuns[1]).toBe("2026-05-02T09:00:00.000Z");
    expect(result.nextRuns[2]).toBe("2026-05-03T09:00:00.000Z");
  });

  it("returns a non-empty English describe", async () => {
    const result = (
      await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC" })
    )._unsafeUnwrap();
    expect(result.describe.length).toBeGreaterThan(0);
    expect(/[\u4e00-\u9fa5]/.test(result.describe)).toBe(false);
  });

  it("honours an explicit n=1", async () => {
    const result = (
      await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC", n: 1 })
    )._unsafeUnwrap();
    expect(result.nextRuns).toHaveLength(1);
    expect(result.nextRuns[0]).toBe("2026-05-01T09:00:00.000Z");
  });

  it("honours an explicit n=10", async () => {
    const result = (
      await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC", n: 10 })
    )._unsafeUnwrap();
    expect(result.nextRuns).toHaveLength(10);
    expect(result.nextRuns[0]).toBe("2026-05-01T09:00:00.000Z");
    expect(result.nextRuns[9]).toBe("2026-05-10T09:00:00.000Z");
  });

  it("rejects n=0 with ScheduleError", async () => {
    const result = await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC", n: 0 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("PreviewCountOutOfRange");
  });

  it("rejects n above upper bound (101) with ScheduleError", async () => {
    const result = await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC", n: 101 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("PreviewCountOutOfRange");
  });

  it("rejects non-integer n with ScheduleError", async () => {
    const result = await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "UTC", n: 2.5 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("PreviewCountOutOfRange");
  });

  it("rejects 6-field cron with the locked literal phrase", async () => {
    const result = await h.module.previewSchedule.execute({ expr: "*/5 * * * * *", tz: "UTC" });
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.type).toBe("InvalidCronExpr");
    if (err.type === "InvalidCronExpr")
      expect(err.reason).toContain("6-field cron not supported in v1");
  });

  it("rejects unknown timezone", async () => {
    const result = await h.module.previewSchedule.execute({ expr: "0 9 * * *", tz: "Not/A_Zone" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidTimezone");
  });
});
