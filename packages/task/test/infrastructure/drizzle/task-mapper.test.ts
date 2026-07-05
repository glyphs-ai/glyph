import { describe, expect, it } from "vitest";
import { TaskBriefSchema } from "../../../src/domain/task-brief.js";
import { TaskEntity } from "../../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../../src/domain/task-id.js";
import { TaskMapper } from "../../../src/infrastructure/drizzle/task-mapper.js";
import type { TaskRow } from "../../../src/infrastructure/drizzle/task-schema.js";

const ID: TaskId = TaskIdSchema.parse("20260508-9dfbdf05");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

function baseRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "20260508-9dfbdf05",
    agent: "public/demo",
    runtime: null,
    status: "running",
    brief: "do it",
    details: null,
    origin: "standalone",
    originId: null,
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    endedAt: null,
    success: null,
    failure: null,
    cancellation: null,
    metadata: "{}",
    ...overrides,
  };
}

/** Comparable projection of every entity getter, for round-trip assertions. */
function snapshot(t: TaskEntity) {
  return {
    id: t.id,
    agent: t.agent,
    brief: t.brief,
    details: t.details,
    origin: t.origin,
    originId: t.originId,
    status: t.status,
    metadata: t.metadata,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    success: t.success,
    failure: t.failure,
    cancellation: t.cancellation,
  };
}

describe("TaskMapper.toRow", () => {
  it("promotes metadata.runtime into the runtime column and strips it from the JSON bag", () => {
    const entity = TaskEntity.create({
      id: ID,
      agent: "public/demo",
      brief: TaskBriefSchema.parse("do it"),
      createdAt: CREATED_AT,
      metadata: { runtime: "copilot", foo: "bar" },
    });
    const row = TaskMapper.toRow(entity);
    expect(row.runtime).toBe("copilot");
    expect(JSON.parse(row.metadata)).toEqual({ foo: "bar" });
  });

  it("JSON-encodes the terminal payload columns", () => {
    const succeeded = TaskEntity.create({
      id: ID,
      agent: "a",
      brief: TaskBriefSchema.parse("b"),
      createdAt: CREATED_AT,
    });
    succeeded
      .complete({ output: "done", artifacts: ["ref/a.html"] }, { now: CREATED_AT })
      ._unsafeUnwrap();
    const row = TaskMapper.toRow(succeeded);
    expect(row.status).toBe("succeeded");
    expect(JSON.parse(row.success ?? "null")).toEqual({
      output: "done",
      artifacts: ["ref/a.html"],
    });
    expect(row.failure).toBeNull();
  });
});

describe("TaskMapper.toEntity", () => {
  it("rehydrates a row and folds the runtime column back into metadata", () => {
    const r = TaskMapper.toEntity(baseRow({ runtime: "copilot", metadata: '{"foo":"bar"}' }));
    const entity = r._unsafeUnwrap();
    expect(entity.metadata).toEqual({ foo: "bar", runtime: "copilot" });
  });

  it("round-trips entity -> row -> entity", () => {
    const original = TaskEntity.create({
      id: ID,
      agent: "public/demo",
      brief: TaskBriefSchema.parse("do it"),
      details: "body",
      createdAt: CREATED_AT,
      metadata: { runtime: "copilot", tag: "x" },
    });
    const back = TaskMapper.toEntity(TaskMapper.toRow(original) as TaskRow)._unsafeUnwrap();
    expect(snapshot(back)).toEqual(snapshot(original));
  });

  it("returns CorruptedTask when metadata is not valid JSON", () => {
    const r = TaskMapper.toEntity(baseRow({ metadata: "not-json" }));
    expect(r._unsafeUnwrapErr().type).toBe("CorruptedTask");
  });

  it("returns CorruptedTask (folded from InvalidTaskId) for a malformed stored id", () => {
    const r = TaskMapper.toEntity(baseRow({ id: "not-an-id" }));
    expect(r._unsafeUnwrapErr().type).toBe("CorruptedTask");
  });
});
