import { describe, expect, it } from "vitest";
import { ScheduleEntity } from "../../../src/domain/schedule/schedule-entity.js";
import { ScheduleIdSchema } from "../../../src/domain/schedule/schedule-id.js";
import type { ScheduleTargetEnvelope } from "../../../src/domain/schedule/schedule-target.js";
import type { ScheduleTrigger } from "../../../src/domain/schedule/schedule-trigger.js";
import type { ScheduleRow } from "../../../src/infrastructure/drizzle/schedule-db.js";
import { ScheduleMapper } from "../../../src/infrastructure/drizzle/schedule-mapper.js";

const VALID_ID = ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
const FIXED_NOW = new Date("2026-05-01T00:00:00.000Z");

interface CreateScheduleOpts {
  readonly name: string;
  readonly trigger: ScheduleTrigger;
  readonly target: ScheduleTargetEnvelope;
  readonly enabled?: boolean;
}

function baseCreateOpts(over: Partial<CreateScheduleOpts> = {}): CreateScheduleOpts {
  return {
    name: "daily-report",
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent: "report-bot", brief: "Run the daily report" } },
    ...over,
  };
}

function create(over: Partial<CreateScheduleOpts> = {}): ScheduleEntity {
  return ScheduleEntity.create(baseCreateOpts(over), {
    id: VALID_ID,
    now: FIXED_NOW,
  })._unsafeUnwrap();
}

function makeRow(over: Partial<ScheduleRow> = {}): ScheduleRow {
  const data = { agent: "report-bot", brief: "Run" };
  return {
    id: VALID_ID,
    name: "daily-report",
    triggerKind: "cron",
    triggerExpr: "0 9 * * *",
    triggerTz: "UTC",
    targetKind: "task",
    targetJson: JSON.stringify(data),
    enabled: true,
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
    lastFiredAt: null,
    nextFireAt: null,
    ...over,
  };
}

describe("ScheduleEntity.toRow / fromStored round-trip", () => {
  it("toRow stores target_json as the DATA payload only (not the full envelope)", () => {
    const row = ScheduleMapper.toRow(create());
    expect(row.targetKind).toBe("task");
    expect(row.targetJson).toBe(
      JSON.stringify({ agent: "report-bot", brief: "Run the daily report" }),
    );
    const parsed = JSON.parse(row.targetJson) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, "kind")).toBe(false);
    expect(parsed.agent).toBe("report-bot");
    expect(parsed.brief).toBe("Run the daily report");
  });

  it("toRow with details + runtime serialises them inside target_json", () => {
    const row = ScheduleMapper.toRow(
      create({
        target: {
          kind: "task",
          data: {
            agent: "report-bot",
            brief: "Hi",
            details: "Full body here.",
            runtime: "copilot-cli",
          },
        },
      }),
    );
    const parsed = JSON.parse(row.targetJson) as Record<string, unknown>;
    expect(parsed.agent).toBe("report-bot");
    expect(parsed.brief).toBe("Hi");
    expect(parsed.details).toBe("Full body here.");
    expect(parsed.runtime).toBe("copilot-cli");
  });

  it("round-trips through fromStored losslessly (kind in column, data in JSON)", () => {
    const e = create();
    const hydrated = ScheduleMapper.toEntity(
      ScheduleMapper.toRow(e) as ScheduleRow,
    )._unsafeUnwrap();
    expect(hydrated.id).toBe(e.id);
    expect(hydrated.name).toBe(e.name);
    expect(hydrated.trigger).toEqual(e.trigger);
    expect(hydrated.target.kind).toBe(e.target.kind);
    expect(hydrated.target.data).toEqual(e.target.data);
    expect(hydrated.enabled).toBe(e.enabled);
    expect(hydrated.createdAt).toBe(e.createdAt);
    expect(hydrated.updatedAt).toBe(e.updatedAt);
  });

  it("round-trips an arbitrary opaque payload (substrate is kind-agnostic)", () => {
    const e = create({
      target: {
        kind: "task",
        data: { nested: { deeply: ["arbitrary", "shape"] }, flag: true, n: 42 },
      },
    });
    const hydrated = ScheduleMapper.toEntity(
      ScheduleMapper.toRow(e) as ScheduleRow,
    )._unsafeUnwrap();
    expect(hydrated.target.data).toEqual({
      nested: { deeply: ["arbitrary", "shape"] },
      flag: true,
      n: 42,
    });
  });
});

describe("ScheduleEntity.fromStored corruption guards", () => {
  it("throws on unknown trigger_kind", () => {
    const result = ScheduleMapper.toEntity(makeRow({ triggerKind: "interval" }));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleCorruption");
  });

  it("accepts arbitrary target_kind on read (substrate is kind-blind; preflight is the gate)", () => {
    const e = ScheduleMapper.toEntity(makeRow({ targetKind: "workflow" }))._unsafeUnwrap();
    expect(e.target.kind).toBe("workflow");
  });

  it("throws on target_json that is not valid JSON", () => {
    const result = ScheduleMapper.toEntity(makeRow({ targetJson: "not json" }));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("ScheduleCorruption");
  });

  it("hydrates lastFiredAt + nextFireAt to undefined when row column is null", () => {
    const e = ScheduleMapper.toEntity(makeRow())._unsafeUnwrap();
    expect(e.lastFiredAt).toBeUndefined();
    expect(e.nextFireAt).toBeUndefined();
  });
});
