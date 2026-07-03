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

describe("PatchScheduleUseCase", () => {
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

  it("patch(name) updates name and stamps updatedAt; preserves nextFireAt", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T01:00:00.000Z"));
    const p = (
      await h.module.patchSchedule.execute({ id: VALID_UUIDS[0], name: "renamed" })
    )._unsafeUnwrap();
    expect(p.name).toBe("renamed");
    expect(p.updatedAt).toBe("2026-05-01T01:00:00.000Z");
    expect(p.nextFireAt).toBe("2026-05-01T09:00:00.000Z");
  });

  it("patch(trigger) recomputes nextFireAt", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T00:30:00.000Z"));
    const p = (
      await h.module.patchSchedule.execute({
        id: VALID_UUIDS[0],
        trigger: { kind: "cron", expr: "0 10 * * *", tz: "UTC" },
      })
    )._unsafeUnwrap();
    expect(p.nextFireAt).toBe("2026-05-01T10:00:00.000Z");
  });

  it("patch(enabled: true → false) clears nextFireAt", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const p = (
      await h.module.patchSchedule.execute({ id: VALID_UUIDS[0], enabled: false })
    )._unsafeUnwrap();
    expect(p.enabled).toBe(false);
    expect(p.nextFireAt).toBeUndefined();
  });

  it("patch(enabled: false → true) recomputes nextFireAt", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts({ enabled: false })))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T05:00:00.000Z"));
    const p = (
      await h.module.patchSchedule.execute({ id: VALID_UUIDS[0], enabled: true })
    )._unsafeUnwrap();
    expect(p.enabled).toBe(true);
    expect(p.nextFireAt).toBe("2026-05-01T09:00:00.000Z");
  });

  it("patch on missing id errs ScheduleNotFound", async () => {
    const result = await h.module.patchSchedule.execute({
      id: "550e8400-e29b-41d4-a716-44665544aaaa",
      name: "x",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
  });

  it("patch(expectedKind) errs ScheduleKindMismatch when current kind differs", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const result = await h.module.patchSchedule.execute({
      id: VALID_UUIDS[0],
      name: "x",
      expectedKind: "workflow",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleKindMismatch");
  });

  it("patch without expectedKind does NOT enforce the kind check for polymorphic patches", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    const p = (
      await h.module.patchSchedule.execute({ id: VALID_UUIDS[0], name: "renamed" })
    )._unsafeUnwrap();
    expect(p.name).toBe("renamed");
  });

  it("patch(target) routes through handler.mergePatch then handler.validate({ changedKeys })", async () => {
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.taskHandler.validateCalls.length = 0;
    h.taskHandler.mergePatchCalls.length = 0;
    const p = (
      await h.module.patchSchedule.execute({
        id: VALID_UUIDS[0],
        target: { patch: { brief: "new brief" } },
      })
    )._unsafeUnwrap();
    expect(h.taskHandler.mergePatchCalls).toHaveLength(1);
    expect(h.taskHandler.mergePatchCalls[0]?.existing).toEqual({
      agent: "report-bot",
      brief: "Run the daily report",
    });
    expect(h.taskHandler.mergePatchCalls[0]?.patch).toEqual({ brief: "new brief" });
    expect(h.taskHandler.validateCalls).toHaveLength(1);
    expect(h.taskHandler.validateCalls[0]?.changedKeys).toEqual(["brief"]);
    expect(p.target.kind).toBe("task");
    expect(p.target.data).toEqual({ agent: "report-bot", brief: "new brief" });
  });
});
