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

describe("RunScheduleUseCase", () => {
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

  it("routes through handler.dispatch with { scheduleId, firedAt, data } and returns its dispatchId", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T09:00:00.000Z"));
    const { dispatchId } = (
      await h.module.runSchedule.execute({ id: VALID_UUIDS[0] })
    )._unsafeUnwrap();
    expect(dispatchId).toBe("dispatch-1");
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
    const call = h.taskHandler.dispatchCalls[0]!;
    expect(call.scheduleId).toBe(VALID_UUIDS[0]);
    expect(call.firedAt).toBe("2026-05-01T09:00:00.000Z");
    expect(call.data).toEqual({ agent: "report-bot", brief: "Run the daily report" });
  });

  it("run with mismatched expectedKind reads as ScheduleNotFound (no dispatch)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const result = await h.module.runSchedule.execute({
      id: VALID_UUIDS[0],
      expectedKind: "workflow",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
    expect(h.taskHandler.dispatchCalls).toHaveLength(0);
  });

  it("is always allowed even when disabled (bypasses the enabled gate)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    (await h.module.runSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });

  it("records lastFiredAt + recomputes nextFireAt without re-arming", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T09:00:00.000Z"));
    (await h.module.runSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after?.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
  });

  it("errs ScheduleNotFound on a missing id", async () => {
    const result = await h.module.runSchedule.execute({
      id: "550e8400-e29b-41d4-a716-44665544aaaa",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
  });

  it("errs InvalidScheduleId on a non-UUID id", async () => {
    const result = await h.module.runSchedule.execute({ id: "not-a-uuid" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleId");
  });

  it("maps a handler.dispatch throw to DatabaseUnavailable (does not record a fire)", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.taskHandler.dispatch = async () => {
      throw new Error("substrate down");
    };
    const result = await h.module.runSchedule.execute({ id: VALID_UUIDS[0] });
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.type).toBe("DatabaseUnavailable");
    if (err.type === "DatabaseUnavailable") expect(err.cause).toEqual(new Error("substrate down"));
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBeUndefined();
  });
});
