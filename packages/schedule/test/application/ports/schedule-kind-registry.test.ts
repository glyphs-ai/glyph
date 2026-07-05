import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateScheduleRequest } from "../../../src/application/create-schedule.js";
import {
  fixedRandomUUID,
  makeScheduleTestHandle,
  makeStubHandler,
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

describe("ScheduleEngine — open kind registry", () => {
  let h: ScheduleTestHandle;

  beforeEach(async () => {
    h = await makeScheduleTestHandle({
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      skipRegisterTask: true,
    });
  });

  afterEach(async () => {
    await h.close();
  });

  it("registerKind errs ScheduleKindAlreadyRegistered on duplicate", () => {
    expect(h.module.engine.registerKind("task", makeStubHandler()).isOk()).toBe(true);
    const dup = h.module.engine.registerKind("task", makeStubHandler());
    expect(dup.isErr()).toBe(true);
    expect(dup._unsafeUnwrapErr().type).toBe("ScheduleKindAlreadyRegistered");
  });

  it.each([
    "",
    "   ",
    "Task",
    "1task",
    "task!",
    "task name",
  ])("registerKind rejects invalid kind name %j", (badKind) => {
    const result = h.module.engine.registerKind(badKind, makeStubHandler());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("InvalidScheduleKindName");
  });

  it("registerKind accepts valid kind names (a..z, 0..9, _, -)", () => {
    expect(h.module.engine.registerKind("task", makeStubHandler()).isOk()).toBe(true);
    expect(h.module.engine.registerKind("workflow_v2", makeStubHandler()).isOk()).toBe(true);
    expect(h.module.engine.registerKind("webhook-fanout", makeStubHandler()).isOk()).toBe(true);
  });

  it("create with an unregistered kind errs ScheduleKindNotRegistered", async () => {
    h.module.engine.registerKind("task", makeStubHandler());
    const result = await h.module.createSchedule.execute({
      ...baseCreateOpts(),
      target: { kind: "unregistered", data: {} },
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleKindNotRegistered");
  });

  it("two kinds coexist without cross-contamination", async () => {
    const taskH = makeStubHandler();
    const noopH = makeStubHandler();
    h.module.engine.registerKind("task", taskH);
    h.module.engine.registerKind("noop", noopH);
    const s1 = (
      await h.module.createSchedule.execute({
        name: "task-sched",
        trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
        target: { kind: "task", data: { agent: "report-bot", brief: "X" } },
        enabled: false,
      })
    )._unsafeUnwrap();
    (await h.module.runSchedule.execute({ id: s1.id }))._unsafeUnwrap();
    const s2 = (
      await h.module.createSchedule.execute({
        name: "noop-sched",
        trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
        target: { kind: "noop", data: { msg: "ping" } },
        enabled: false,
      })
    )._unsafeUnwrap();
    (await h.module.runSchedule.execute({ id: s2.id }))._unsafeUnwrap();
    expect(taskH.dispatchCalls).toHaveLength(1);
    expect(taskH.dispatchCalls[0]?.data).toEqual({ agent: "report-bot", brief: "X" });
    expect(noopH.dispatchCalls).toHaveLength(1);
    expect(noopH.dispatchCalls[0]?.data).toEqual({ msg: "ping" });
  });
});
