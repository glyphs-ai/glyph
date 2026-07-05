import { ResultAsync } from "neverthrow";
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

describe("ScheduleService shutdown awaits in-flight fires", () => {
  let h: ScheduleTestHandle;

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

  it("shutdown() awaits in-flight fire() before resolving", async () => {
    let resolveDispatch!: () => void;
    const dispatchPromise = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const origDispatch = h.taskHandler.dispatch.bind(h.taskHandler);
    h.taskHandler.dispatch = (opts) =>
      new ResultAsync(
        (async () => {
          const result = await origDispatch(opts);
          await dispatchPromise;
          return result;
        })(),
      );
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    let shutdownResolved = false;
    const shutdownP = h.module.engine.shutdown().then(() => {
      shutdownResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);
    resolveDispatch();
    await shutdownP;
    expect(shutdownResolved).toBe(true);
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });

  it("fire() skips recordFired after shutdown to prevent DB-closed race", async () => {
    let resolveDispatch!: () => void;
    const dispatchPromise = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const origDispatch = h.taskHandler.dispatch.bind(h.taskHandler);
    h.taskHandler.dispatch = (opts) =>
      new ResultAsync(
        (async () => {
          const result = await origDispatch(opts);
          await dispatchPromise;
          return result;
        })(),
      );
    (await h.module.createSchedule.execute(baseCreateOpts()))._unsafeUnwrap();
    h.setNow(new Date("2026-05-01T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    const shutdownP = h.module.engine.shutdown();
    resolveDispatch();
    await shutdownP;
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
    const after = (await h.repo.get(VALID_UUIDS[0]))._unsafeUnwrap();
    expect(after.lastFiredAt).toBeUndefined();
  });
});
