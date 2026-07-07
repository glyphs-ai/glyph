import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CreateScheduleRequest {
  readonly name: string;
  readonly trigger: { readonly kind: "cron"; readonly expr: string; readonly tz: string };
  readonly target: { readonly kind: string; readonly data: unknown };
  readonly enabled?: boolean;
}

import { ScheduleEngine } from "../../../src/application/engine/schedule-engine.js";
import { DefaultScheduleKindRegistry } from "../../../src/application/ports/schedule-kind-registry.js";
import { ScheduleEntity } from "../../../src/domain/schedule/schedule-entity.js";
import type { DatabaseUnavailable } from "../../../src/domain/schedule/schedule-repository.js";
import { DrizzleScheduleQueries } from "../../../src/infrastructure/drizzle/schedule-queries.js";
import { DrizzleScheduleRepository } from "../../../src/infrastructure/drizzle/schedule-repository.js";
import { openTestScheduleDb } from "../../testing.js";
import {
  fixedRandomUUID,
  makeScheduleTestHandle,
  makeStubHandler,
  type StubHandler,
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

function createEntity(id = VALID_UUIDS[0]) {
  return ScheduleEntity.create(baseCreateOpts(), {
    id,
    now: new Date("2026-05-01T00:00:00.000Z"),
  })._unsafeUnwrap();
}

describe("ScheduleService.recover resilience (P1 regression)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT recordFired when dispatch fails (no lost tick on retry)", async () => {
    const h = await makeScheduleTestHandle({
      initialNow: new Date("2026-05-02T00:00:00.000Z"),
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      taskHandler: makeStubHandler(),
    });
    h.taskHandler.dispatch = () => errAsync({ cause: new Error("simulated dispatch failure") });
    try {
      const plannedFireIso = "2026-05-01T18:00:00.000Z";
      const seeded = createEntity();
      seeded.recordFired("2026-05-01T09:00:00.000Z", plannedFireIso);
      (await h.repo.save(seeded))._unsafeUnwrap();
      await h.module.engine.recover();
      const after = (await h.repo.get(VALID_UUIDS[0]))._unsafeUnwrap();
      expect(after.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
      expect(after.nextFireAt).toBe(plannedFireIso);
    } finally {
      await h.close();
    }
  });

  it("one row's failure does not abort recovery for remaining rows", async () => {
    const handler = makeStubHandler();
    let callCount = 0;
    handler.dispatch = (opts) => {
      callCount++;
      if (opts.scheduleId === VALID_UUIDS[0])
        return errAsync({ cause: new Error("first row always fails") });
      return okAsync({ id: `dispatch-${callCount}` });
    };
    const h = await makeScheduleTestHandle({
      initialNow: new Date("2026-05-02T00:00:00.000Z"),
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      taskHandler: handler,
    });
    try {
      const plannedFire1 = "2026-05-01T18:00:00.000Z";
      const seeded1 = createEntity(VALID_UUIDS[0]);
      seeded1.recordFired("2026-05-01T09:00:00.000Z", plannedFire1);
      (await h.repo.save(seeded1))._unsafeUnwrap();
      const plannedFire2 = "2026-05-01T21:00:00.000Z";
      const seeded2 = ScheduleEntity.create(baseCreateOpts({ name: "second" }), {
        id: VALID_UUIDS[1],
        now: new Date("2026-05-01T00:00:00.000Z"),
      })._unsafeUnwrap();
      seeded2.recordFired("2026-05-01T09:00:00.000Z", plannedFire2);
      (await h.repo.save(seeded2))._unsafeUnwrap();
      await h.module.engine.recover();
      const after2 = (await h.repo.get(VALID_UUIDS[1]))._unsafeUnwrap();
      expect(after2.lastFiredAt).toBe(plannedFire2);
      expect(after2.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
      const after1 = (await h.repo.get(VALID_UUIDS[0]))._unsafeUnwrap();
      expect(after1.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
      expect(after1.nextFireAt).toBe(plannedFire1);
    } finally {
      await h.close();
    }
  });

  it("recordFired failure does not corrupt the schedule (no double-fire on re-recover)", async () => {
    const db = await openTestScheduleDb();
    const plannedFireIso = "2026-05-01T18:00:00.000Z";
    const seeded = createEntity();
    seeded.recordFired("2026-05-01T09:00:00.000Z", plannedFireIso);
    const baseRepo = new DrizzleScheduleRepository({ db: db.db });
    (await baseRepo.save(seeded))._unsafeUnwrap();
    class FailingSaveRepository extends DrizzleScheduleRepository {
      saveCalls = 0;
      override save(entity: ScheduleEntity): ResultAsync<void, DatabaseUnavailable> {
        this.saveCalls += 1;
        if (this.saveCalls === 1) {
          return errAsync({
            type: "DatabaseUnavailable",
            cause: new Error("simulated recordFired failure"),
          });
        }
        return super.save(entity);
      }
    }
    const repo = new FailingSaveRepository({ db: db.db });
    const queries = new DrizzleScheduleQueries({ db: db.db });
    const registry = new DefaultScheduleKindRegistry();
    const handler: StubHandler = makeStubHandler();
    registry.register("task", handler);
    const nowRef = { value: new Date("2026-05-02T00:00:00.000Z") };
    const engine = new ScheduleEngine({ repo, queries, registry, now: () => nowRef.value });
    try {
      await engine.recover();
      await engine.shutdown();
      expect(handler.dispatchCalls).toHaveLength(1);
      const after = (await baseRepo.get(VALID_UUIDS[0]))._unsafeUnwrap();
      expect(after.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
      expect(after.nextFireAt).toBe(plannedFireIso);
      const handler2 = makeStubHandler();
      const registry2 = new DefaultScheduleKindRegistry();
      registry2.register("task", handler2);
      const engine2 = new ScheduleEngine({
        repo: baseRepo,
        queries,
        registry: registry2,
        now: () => nowRef.value,
      });
      await engine2.recover();
      expect(handler2.dispatchCalls).toHaveLength(1);
      expect(handler2.dispatchCalls[0]?.firedAt).toBe(plannedFireIso);
      await engine2.shutdown();
    } finally {
      await engine.shutdown();
      db.close();
    }
  });
});
