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

describe("ListSchedulesUseCase", () => {
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

  it("list filters by enabled flag", async () => {
    (
      await h.module.createSchedule.execute(baseCreateOpts({ name: "a", enabled: true }))
    )._unsafeUnwrap();
    (
      await h.module.createSchedule.execute(baseCreateOpts({ name: "b", enabled: false }))
    )._unsafeUnwrap();
    const enabled = (await h.module.listSchedules.execute({ enabled: true }))._unsafeUnwrap();
    expect(enabled.map((s) => s.name)).toEqual(["a"]);
    const disabled = (await h.module.listSchedules.execute({ enabled: false }))._unsafeUnwrap();
    expect(disabled.map((s) => s.name)).toEqual(["b"]);
  });

  it("list filters by generic dataEquals { kind, path, value }", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ name: "a" })))._unsafeUnwrap();
    (
      await h.module.createSchedule.execute(
        baseCreateOpts({
          name: "b",
          target: { kind: "task", data: { agent: "other-bot", brief: "x" } },
        }),
      )
    )._unsafeUnwrap();
    const filtered = (
      await h.module.listSchedules.execute({
        kind: "task",
        dataEquals: { path: "$.agent", value: "report-bot" },
      })
    )._unsafeUnwrap();
    expect(filtered.map((s) => s.name)).toEqual(["a"]);
  });

  it("list errs InvalidJsonPath for an SQL-injection-shaped path", async () => {
    const result = await h.module.listSchedules.execute({
      kind: "task",
      dataEquals: { path: "'; DROP TABLE schedules; --", value: "writer" },
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidJsonPath");
  });
});
