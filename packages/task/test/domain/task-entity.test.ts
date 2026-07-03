import { describe, expect, it } from "vitest";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import type { TaskFailure } from "../../src/domain/task-failure.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskStatus } from "../../src/domain/task-status.js";
import type { TaskSuccess } from "../../src/domain/task-success.js";

const ID: TaskId = TaskIdSchema.parse("20260508-9dfbdf05");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

function running(): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "public/demo",
    brief: TaskBriefSchema.parse("do it"),
    createdAt: CREATED_AT,
  });
}

describe("TaskEntity.create", () => {
  it("starts in running status with startedAt = createdAt and no terminal payload", () => {
    const t = running();
    expect(t.status).toBe("running");
    expect(t.createdAt).toBe(CREATED_AT);
    expect(t.startedAt).toBe(CREATED_AT);
    expect(t.endedAt).toBeUndefined();
    expect(t.success).toBeUndefined();
    expect(t.origin).toBe("standalone");
  });

  it("freezes the metadata bag against mutation", () => {
    const t = TaskEntity.create({
      id: ID,
      agent: "a",
      brief: TaskBriefSchema.parse("b"),
      createdAt: CREATED_AT,
      metadata: { runtime: "copilot" },
    });
    expect(() => {
      (t.metadata as Record<string, unknown>).runtime = "hacked";
    }).toThrow();
  });
});

describe("TaskEntity.metadataString", () => {
  function withMeta(metadata: Record<string, unknown>): TaskEntity {
    return TaskEntity.create({
      id: ID,
      agent: "a",
      brief: TaskBriefSchema.parse("b"),
      createdAt: CREATED_AT,
      metadata,
    });
  }

  it("returns the value for a non-empty string key", () => {
    expect(withMeta({ runtime: "copilot" }).metadataString("runtime")).toBe("copilot");
  });

  it("returns undefined for an absent key", () => {
    expect(withMeta({ runtime: "copilot" }).metadataString("runtimeSessionId")).toBeUndefined();
  });

  it("returns undefined for a non-string value", () => {
    expect(withMeta({ attempt: 3 }).metadataString("attempt")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(withMeta({ runtime: "" }).metadataString("runtime")).toBeUndefined();
  });
});

describe("TaskEntity.rehydrate", () => {
  const base = {
    id: "20260508-9dfbdf05",
    agent: "public/demo",
    brief: "do it",
    origin: "standalone",
    status: "running" as TaskStatus,
    metadata: {},
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
  };

  it("rehydrates a valid running row", () => {
    const r = TaskEntity.rehydrate(base);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().id).toBe("20260508-9dfbdf05");
  });

  it("returns InvalidTaskId for a malformed id", () => {
    const r = TaskEntity.rehydrate({ ...base, id: "not-an-id" });
    expect(r._unsafeUnwrapErr().type).toBe("InvalidTaskId");
  });

  it("returns CorruptedTask for an empty brief", () => {
    const r = TaskEntity.rehydrate({ ...base, brief: "" });
    const e = r._unsafeUnwrapErr();
    expect(e.type).toBe("CorruptedTask");
  });

  it("returns CorruptedTask when a terminal status lacks its payload", () => {
    const r = TaskEntity.rehydrate({ ...base, status: "succeeded" });
    expect(r._unsafeUnwrapErr().type).toBe("CorruptedTask");
  });

  it("returns CorruptedTask when a non-terminal status carries a terminal payload", () => {
    const r = TaskEntity.rehydrate({
      ...base,
      success: { output: "x" } satisfies TaskSuccess,
    });
    expect(r._unsafeUnwrapErr().type).toBe("CorruptedTask");
  });

  it("returns CorruptedTask when an execution failure carries neither exitCode nor signal", () => {
    const r = TaskEntity.rehydrate({
      ...base,
      status: "failed",
      failure: { kind: "execution", message: "x" } as unknown as TaskFailure,
    });
    expect(r._unsafeUnwrapErr().type).toBe("CorruptedTask");
  });
});

describe("TaskEntity transitions (in-place)", () => {
  it("complete moves running -> succeeded with the payload + endedAt", () => {
    const t = running();
    const r = t.complete({ output: "done", artifacts: [] }, { now: "2026-05-08T02:00:00.000Z" });
    expect(r.isOk()).toBe(true);
    expect(t.status).toBe("succeeded");
    expect(t.endedAt).toBe("2026-05-08T02:00:00.000Z");
    expect(t.success?.output).toBe("done");
  });

  it("fail moves running -> failed", () => {
    const t = running();
    t.fail({ kind: "cascade", message: "server shutdown" })._unsafeUnwrap();
    expect(t.status).toBe("failed");
  });

  it("cancel moves running -> cancelled", () => {
    const t = running();
    t.cancel({ kind: "user", message: "cancelled by user" })._unsafeUnwrap();
    expect(t.status).toBe("cancelled");
  });

  it("rejects a transition from a terminal status with InvalidTransition", () => {
    const t = running();
    t.complete({ output: null }, { now: CREATED_AT })._unsafeUnwrap();
    const again = t.fail({ kind: "internal", message: "x" });
    const e = again._unsafeUnwrapErr();
    expect(e.type).toBe("InvalidTransition");
    expect(e.from).toBe("succeeded");
  });

  it("leaves the entity unchanged when a transition is rejected", () => {
    const t = running();
    t.complete({ output: null }, { now: CREATED_AT })._unsafeUnwrap();
    t.cancel({ kind: "user", message: "too late" });
    expect(t.status).toBe("succeeded");
  });
});

describe("TaskEntity terminal payload getters", () => {
  it("exposes exactly the matching terminal payload", () => {
    const cancelled = running();
    cancelled.cancel({ kind: "user", message: "stop" }, { now: CREATED_AT })._unsafeUnwrap();
    expect(cancelled.cancellation).toEqual({ kind: "user", message: "stop" });
    expect(cancelled.success).toBeUndefined();
    expect(cancelled.failure).toBeUndefined();
    expect(cancelled.details).toBeUndefined();
  });
});
