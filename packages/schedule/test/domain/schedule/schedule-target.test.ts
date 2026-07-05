import { describe, expect, it } from "vitest";
import { ScheduleTargetEnvelopeSchema } from "../../../src/domain/schedule/schedule-target.js";

describe("schedule-target.ScheduleTargetEnvelopeSchema", () => {
  it("parses a { kind, data } envelope", () => {
    const parsed = ScheduleTargetEnvelopeSchema.parse({
      kind: "task",
      data: { agent: "writer", brief: "go" },
    });
    expect(parsed).toEqual({ kind: "task", data: { agent: "writer", brief: "go" } });
  });

  it("treats data as opaque — accepts any payload shape (object, array, primitive, null)", () => {
    expect(ScheduleTargetEnvelopeSchema.safeParse({ kind: "task", data: 42 }).success).toBe(true);
    expect(ScheduleTargetEnvelopeSchema.safeParse({ kind: "task", data: ["a"] }).success).toBe(
      true,
    );
    expect(ScheduleTargetEnvelopeSchema.safeParse({ kind: "task", data: null }).success).toBe(true);
    expect(
      ScheduleTargetEnvelopeSchema.safeParse({ kind: "workflow", data: { nodes: [] } }).success,
    ).toBe(true);
  });

  it("requires a string kind and a present data key", () => {
    expect(ScheduleTargetEnvelopeSchema.safeParse({ kind: 7, data: {} }).success).toBe(false);
    // `data` is opaque but not optional — a target must carry a payload.
    expect(ScheduleTargetEnvelopeSchema.safeParse({ kind: "task" }).success).toBe(false);
  });
});
