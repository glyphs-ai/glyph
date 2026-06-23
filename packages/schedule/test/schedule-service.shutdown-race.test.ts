import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleRepository } from "../src/schedule-repository.js";
import { ScheduleService } from "../src/schedule-service.js";
import { openTestScheduleDb } from "../src/testing.js";
import type { CreateScheduleOpts } from "../src/types.js";
import { fixedRandomUUID, makeStubHandler, VALID_UUIDS } from "./_helpers.js";

function baseCreateOpts(over: Partial<CreateScheduleOpts> = {}): CreateScheduleOpts {
  return {
    name: "daily-report",
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent: "report-bot", brief: "Run the daily report" } },
    ...over,
  };
}

describe("ScheduleService shutdown awaits in-flight fires", () => {
  let db: ReturnType<typeof openTestScheduleDb>;
  let repo: ScheduleRepository;
  let handler: ReturnType<typeof makeStubHandler>;
  let service: ScheduleService;
  let nowRef: { value: Date };

  beforeEach(() => {
    vi.useFakeTimers();
    db = openTestScheduleDb();
    repo = new ScheduleRepository({ db: db.db });
    handler = makeStubHandler();
    nowRef = { value: new Date("2026-05-01T08:59:00.000Z") };
    service = new ScheduleService({
      repo,
      now: () => nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
    service.registerKind("task", handler);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("shutdown() awaits in-flight fire() before resolving", async () => {
    // Make dispatch take time to complete so fire() is mid-flight
    // when shutdown is called.
    let resolveDispatch!: () => void;
    const dispatchPromise = new Promise<void>((r) => {
      resolveDispatch = r;
    });
    const origDispatch = handler.dispatch.bind(handler);
    handler.dispatch = async (opts) => {
      const result = await origDispatch(opts);
      await dispatchPromise;
      return result;
    };

    await service.create(baseCreateOpts());
    nowRef.value = new Date("2026-05-01T09:00:00.000Z");
    // Advance timers to trigger the fire.
    await vi.advanceTimersByTimeAsync(60_000);

    // fire() is now in-flight (blocked on dispatchPromise).
    // shutdown() should wait for it.
    let shutdownResolved = false;
    const shutdownP = service.shutdown().then(() => {
      shutdownResolved = true;
    });

    // Give microtasks a chance to settle — shutdown should NOT
    // have resolved yet because dispatch is still pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    // Unblock the dispatch.
    resolveDispatch();
    await shutdownP;
    expect(shutdownResolved).toBe(true);

    // The fire completed — recordFired was skipped (shutdownCalled)
    // OR completed before shutdown saw it. Either way, no crash.
    expect(handler.dispatchCalls).toHaveLength(1);
  });

  it("fire() skips recordFired after shutdown to prevent DB-closed race", async () => {
    // Simulate the race: dispatch completes, but shutdown has been
    // called by the time recordFired would run.
    let resolveDispatch!: () => void;
    const dispatchPromise = new Promise<void>((r) => {
      resolveDispatch = r;
    });
    const origDispatch = handler.dispatch.bind(handler);
    handler.dispatch = async (opts) => {
      const result = await origDispatch(opts);
      await dispatchPromise;
      return result;
    };

    await service.create(baseCreateOpts());
    nowRef.value = new Date("2026-05-01T09:00:00.000Z");
    await vi.advanceTimersByTimeAsync(60_000);

    // Call shutdown while fire is in-flight.
    const shutdownP = service.shutdown();

    // Now unblock dispatch — fire() should check shutdownCalled
    // after dispatch returns and skip the trailing recordFired.
    resolveDispatch();
    await shutdownP;

    // Dispatch happened, but recordFired was skipped because
    // shutdownCalled was true after dispatch returned.
    expect(handler.dispatchCalls).toHaveLength(1);
    const after = await repo.findById(VALID_UUIDS[0]!);
    // lastFiredAt should remain unchanged (recordFired was skipped).
    expect(after?.lastFiredAt).toBeUndefined();
  });
});
