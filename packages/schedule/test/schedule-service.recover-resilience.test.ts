import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleEntity } from "../src/schedule-entity.js";
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

describe("ScheduleService.recover resilience (P1 regression)", () => {
  let db: ReturnType<typeof openTestScheduleDb>;
  let repo: ScheduleRepository;
  let nowRef: { value: Date };

  beforeEach(() => {
    vi.useFakeTimers();
    db = openTestScheduleDb();
    repo = new ScheduleRepository({ db: db.db });
    nowRef = { value: new Date("2026-05-02T00:00:00.000Z") };
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("does NOT recordFired when dispatch fails (no lost tick on retry)", async () => {
    const handler = makeStubHandler();
    // Make dispatch throw for this test.
    handler.dispatch = async () => {
      throw new Error("simulated dispatch failure");
    };

    const service = new ScheduleService({
      repo,
      now: () => nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
    service.registerKind("task", handler);

    // Seed a schedule with past next_fire_at.
    const plannedFireIso = "2026-05-01T18:00:00.000Z";
    const entity = ScheduleEntity.create(baseCreateOpts(), {
      id: VALID_UUIDS[0],
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).withFired("2026-05-01T09:00:00.000Z", plannedFireIso);
    await repo.insert(entity.toRow());

    await service.recover();

    // Dispatch was attempted but failed — recordFired must NOT have
    // advanced last_fired_at/next_fire_at, preserving the ability
    // to retry on next boot.
    const after = await repo.findById(VALID_UUIDS[0]!);
    expect(after?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after?.nextFireAt).toBe(plannedFireIso);

    await service.shutdown();
  });

  it("one row's failure does not abort recovery for remaining rows", async () => {
    const handler = makeStubHandler();
    let callCount = 0;
    handler.dispatch = async (opts) => {
      callCount++;
      if (opts.scheduleId === VALID_UUIDS[0]) {
        throw new Error("first row always fails");
      }
      return { id: `dispatch-${callCount}` };
    };

    const service = new ScheduleService({
      repo,
      now: () => nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
    service.registerKind("task", handler);

    // Seed two schedules both with past next_fire_at.
    const plannedFire1 = "2026-05-01T18:00:00.000Z";
    const entity1 = ScheduleEntity.create(baseCreateOpts({ name: "first" }), {
      id: VALID_UUIDS[0],
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).withFired("2026-05-01T09:00:00.000Z", plannedFire1);
    await repo.insert(entity1.toRow());

    const plannedFire2 = "2026-05-01T21:00:00.000Z";
    const entity2 = ScheduleEntity.create(baseCreateOpts({ name: "second" }), {
      id: VALID_UUIDS[1],
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).withFired("2026-05-01T09:00:00.000Z", plannedFire2);
    await repo.insert(entity2.toRow());

    // recover() must NOT throw — the first row's failure is isolated.
    await service.recover();

    // Second row was dispatched and recorded successfully.
    const after2 = await repo.findById(VALID_UUIDS[1]!);
    expect(after2?.lastFiredAt).toBe(plannedFire2);
    // next_fire_at was recomputed from now.
    expect(after2?.nextFireAt).toBe("2026-05-02T09:00:00.000Z");

    // First row was NOT advanced (dispatch failed).
    const after1 = await repo.findById(VALID_UUIDS[0]!);
    expect(after1?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after1?.nextFireAt).toBe(plannedFire1);

    await service.shutdown();
  });

  it("recordFired failure does not corrupt the schedule (no double-fire on re-recover)", async () => {
    const handler = makeStubHandler();
    const service = new ScheduleService({
      repo,
      now: () => nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
    service.registerKind("task", handler);

    // Seed a schedule with past next_fire_at.
    const plannedFireIso = "2026-05-01T18:00:00.000Z";
    const entity = ScheduleEntity.create(baseCreateOpts(), {
      id: VALID_UUIDS[0],
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).withFired("2026-05-01T09:00:00.000Z", plannedFireIso);
    await repo.insert(entity.toRow());

    // Make recordFired throw after dispatch succeeds.
    const origRecordFired = repo.recordFired.bind(repo);
    let recordFiredCallCount = 0;
    repo.recordFired = async (...args) => {
      recordFiredCallCount++;
      if (recordFiredCallCount === 1) {
        throw new Error("simulated recordFired failure");
      }
      return origRecordFired(...args);
    };

    // recover() should not throw (error is caught per-row).
    await service.recover();
    await service.shutdown();

    // Dispatch was called once (the catchup).
    expect(handler.dispatchCalls).toHaveLength(1);

    // Because recordFired failed, last_fired_at was NOT advanced.
    const after = await repo.findById(VALID_UUIDS[0]!);
    expect(after?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after?.nextFireAt).toBe(plannedFireIso);

    // A fresh service re-recovering should catchup-fire AGAIN
    // (the tick was effectively lost — this verifies no double-
    // advancement / silent loss).
    const handler2 = makeStubHandler();
    const service2 = new ScheduleService({
      repo,
      now: () => nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS.slice(1)),
    });
    service2.registerKind("task", handler2);
    await service2.recover();

    expect(handler2.dispatchCalls).toHaveLength(1);
    expect(handler2.dispatchCalls[0]?.firedAt).toBe(plannedFireIso);

    await service2.shutdown();
  });
});
