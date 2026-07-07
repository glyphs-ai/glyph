import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CreateScheduleRequest {
  readonly name: string;
  readonly trigger: { readonly kind: "cron"; readonly expr: string; readonly tz: string };
  readonly target: { readonly kind: string; readonly data: unknown };
  readonly enabled?: boolean;
}

import { ScheduleEntity } from "../../../src/domain/schedule/schedule-entity.js";
import { ScheduleMapper } from "../../../src/infrastructure/drizzle/schedule-mapper.js";
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

function entity(over: Partial<CreateScheduleRequest> = {}, id = VALID_UUIDS[0]) {
  return ScheduleEntity.create(baseCreateOpts(over), {
    id,
    now: new Date("2026-05-01T00:00:00.000Z"),
  })._unsafeUnwrap();
}

describe("ScheduleService.recover", () => {
  let h: ScheduleTestHandle;

  beforeEach(async () => {
    vi.useFakeTimers();
    h = await makeScheduleTestHandle({
      initialNow: new Date("2026-05-02T00:00:00.000Z"),
      randomUUID: fixedRandomUUID(VALID_UUIDS),
    });
  });

  afterEach(async () => {
    await h.close();
    vi.useRealTimers();
  });

  it("catchup-fires EXACTLY ONCE for an enabled schedule with past next_fire_at, using planned firedAt", async () => {
    const plannedFireIso = "2026-05-01T18:00:00.000Z";
    const seeded = entity();
    seeded.recordFired("2026-05-01T09:00:00.000Z", plannedFireIso);
    (await h.repo.save(seeded))._unsafeUnwrap();
    await h.module.engine.recover();
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
    const call = h.taskHandler.dispatchCalls[0]!;
    expect(call.firedAt).toBe(plannedFireIso);
    expect(call.scheduleId).toBe(VALID_UUIDS[0]);
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBe(plannedFireIso);
    expect(after?.nextFireAt).toBe("2026-05-02T09:00:00.000Z");
  });

  it("multiple missed fires collapse into ONE catchup", async () => {
    const seeded = ScheduleEntity.create(baseCreateOpts(), {
      id: VALID_UUIDS[0],
      now: new Date("2026-04-28T00:00:00.000Z"),
    })._unsafeUnwrap();
    seeded.recordFired("2026-04-28T09:00:00.000Z", "2026-04-29T09:00:00.000Z");
    (await h.repo.save(seeded))._unsafeUnwrap();
    await h.module.engine.recover();
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });

  it("arms timer (no dispatch) for an enabled schedule with FUTURE next_fire_at", async () => {
    const seeded = ScheduleEntity.create(baseCreateOpts(), {
      id: VALID_UUIDS[0],
      now: h.nowRef.value,
    })._unsafeUnwrap();
    seeded.withNextFireAt("2026-05-02T09:00:00.000Z");
    (await h.repo.save(seeded))._unsafeUnwrap();
    await h.module.engine.recover();
    expect(h.taskHandler.dispatchCalls).toHaveLength(0);
    h.setNow(new Date("2026-05-02T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });

  it("skips disabled schedules entirely (after preflight)", async () => {
    const seeded = entity({ enabled: false });
    seeded.recordFired("2026-05-01T09:00:00.000Z", "2026-05-01T18:00:00.000Z");
    (await h.repo.save(seeded))._unsafeUnwrap();
    await h.module.engine.recover();
    expect(h.taskHandler.dispatchCalls).toHaveLength(0);
    const after = (await h.module.getSchedule.execute({ id: VALID_UUIDS[0] }))._unsafeUnwrap();
    expect(after?.lastFiredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(after?.nextFireAt).toBe("2026-05-01T18:00:00.000Z");
  });

  it("recover is idempotent (second call is a no-op; no double-arming)", async () => {
    const seeded = ScheduleEntity.create(baseCreateOpts(), {
      id: VALID_UUIDS[0],
      now: h.nowRef.value,
    })._unsafeUnwrap();
    seeded.withNextFireAt("2026-05-02T09:00:00.000Z");
    (await h.repo.save(seeded))._unsafeUnwrap();
    await h.module.engine.recover();
    await h.module.engine.recover();
    h.setNow(new Date("2026-05-02T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
    expect(h.taskHandler.dispatchCalls).toHaveLength(1);
  });

  it("registerKind after recover errs ScheduleKindRegistryFrozen", async () => {
    await h.module.engine.recover();
    const result = h.module.engine.registerKind("workflow", makeStubHandler());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleKindRegistryFrozen");
  });

  it("recover preflight errs when an ENABLED row's kind has no registered handler", async () => {
    const other = await makeScheduleTestHandle({
      initialNow: h.nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      skipRegisterTask: true,
    });
    other.module.engine.registerKind("task", makeStubHandler());
    try {
      const row = ScheduleMapper.toRow(entity());
      await other.db.client.execute({
        sql: "INSERT INTO schedules (id, name, trigger_kind, trigger_expr, trigger_tz, target_kind, target_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'workflow', ?, 1, ?, ?)",
        args: [
          row.id,
          row.name,
          row.triggerKind,
          row.triggerExpr,
          row.triggerTz,
          row.targetJson,
          row.createdAt,
          row.updatedAt,
        ],
      });
      const result = await other.module.engine.recover();
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.type).toBe("ScheduleKindNotRegistered");
      expect(error).toMatchObject({ kind: "workflow" });
    } finally {
      await other.close();
    }
  });

  it("recover preflight errs when a DISABLED row's kind has no registered handler (orphan-row gate)", async () => {
    const other = await makeScheduleTestHandle({
      initialNow: h.nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      skipRegisterTask: true,
    });
    other.module.engine.registerKind("task", makeStubHandler());
    try {
      const row = ScheduleMapper.toRow(entity({ enabled: false }));
      await other.db.client.execute({
        sql: "INSERT INTO schedules (id, name, trigger_kind, trigger_expr, trigger_tz, target_kind, target_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'workflow', ?, 0, ?, ?)",
        args: [
          row.id,
          row.name,
          row.triggerKind,
          row.triggerExpr,
          row.triggerTz,
          row.targetJson,
          row.createdAt,
          row.updatedAt,
        ],
      });
      const result = await other.module.engine.recover();
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().type).toBe("ScheduleKindNotRegistered");
    } finally {
      await other.close();
    }
  });

  it("after recover() preflight failure, registry stays frozen (dead-service state)", async () => {
    const other = await makeScheduleTestHandle({
      initialNow: h.nowRef.value,
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      skipRegisterTask: true,
    });
    const taskStub = makeStubHandler();
    other.module.engine.registerKind("task", taskStub);
    try {
      const row = ScheduleMapper.toRow(entity({ enabled: false }));
      await other.db.client.execute({
        sql: "INSERT INTO schedules (id, name, trigger_kind, trigger_expr, trigger_tz, target_kind, target_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'workflow', ?, 0, ?, ?)",
        args: [
          row.id,
          row.name,
          row.triggerKind,
          row.triggerExpr,
          row.triggerTz,
          row.targetJson,
          row.createdAt,
          row.updatedAt,
        ],
      });
      expect((await other.module.engine.recover())._unsafeUnwrapErr().type).toBe(
        "ScheduleKindNotRegistered",
      );
      expect(
        other.module.engine.registerKind("workflow", makeStubHandler())._unsafeUnwrapErr().type,
      ).toBe("ScheduleKindRegistryFrozen");
      // A second recover() is idempotent — the registry stays frozen and it
      // returns ok without re-running preflight.
      expect((await other.module.engine.recover()).isOk()).toBe(true);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(taskStub.dispatchCalls).toHaveLength(0);
    } finally {
      await other.close();
    }
  });
});
