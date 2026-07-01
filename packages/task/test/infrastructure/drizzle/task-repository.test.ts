import { beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../../src/domain/task-id.js";
import { openDb } from "../../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskRepository } from "../../../src/infrastructure/drizzle/task-repository.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: DrizzleTaskRepository;

beforeEach(() => {
  const { db } = openDb(":memory:");
  repo = new DrizzleTaskRepository({ db });
});

function id(n: number): TaskId {
  return TaskIdSchema.parse(`20260508-${n.toString(16).padStart(8, "0")}`);
}

function running(n: number, origin: string, originId?: string, agent = "public/demo"): TaskEntity {
  return TaskEntity.create({
    id: id(n),
    agent,
    brief: "b",
    createdAt: CREATED_AT,
    origin,
    ...(originId !== undefined ? { originId } : {}),
    metadata: { runtime: "copilot" },
  });
}

async function save(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

describe("DrizzleTaskRepository — CRUD", () => {
  it("saves and reads back a task by id", async () => {
    await save(running(1, "standalone"));
    const found = (await repo.findById(id(1)))._unsafeUnwrap();
    expect(found?.id).toBe("20260508-00000001");
    expect(found?.metadata).toEqual({ runtime: "copilot" });
  });

  it("findById resolves to undefined for an absent id", async () => {
    expect((await repo.findById(id(99)))._unsafeUnwrap()).toBeUndefined();
  });

  it("get asserts existence with TaskNotFound", async () => {
    expect((await repo.get(id(99)))._unsafeUnwrapErr().type).toBe("TaskNotFound");
  });

  it("save upserts (second save updates in place)", async () => {
    await save(running(1, "standalone"));
    const done = running(1, "standalone")
      .complete({ output: "x", artifacts: [] }, { now: CREATED_AT })
      ._unsafeUnwrap();
    await save(done);
    expect((await repo.get(id(1)))._unsafeUnwrap().status).toBe("succeeded");
  });

  it("delete removes the row", async () => {
    await save(running(1, "standalone"));
    (await repo.delete(id(1)))._unsafeUnwrap();
    expect((await repo.findById(id(1)))._unsafeUnwrap()).toBeUndefined();
  });
});

describe("DrizzleTaskRepository — findAll filters", () => {
  beforeEach(async () => {
    await save(running(1, "standalone", undefined, "agent-a"));
    await save(running(2, "schedule", "sched-1", "agent-b"));
    await save(running(3, "workflow", "node-1", "agent-a"));
  });

  it("filters by agent", async () => {
    const rows = (await repo.findAll({ agent: "agent-a" }))._unsafeUnwrap();
    expect(rows.map((r) => r.agent)).toEqual(["agent-a", "agent-a"]);
  });

  it("filters by origin + originId", async () => {
    const rows = (await repo.findAll({ origin: "schedule", originId: "sched-1" }))._unsafeUnwrap();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe("schedule");
  });

  it("filters by an array of origins", async () => {
    const rows = (await repo.findAll({ origin: ["schedule", "workflow"] }))._unsafeUnwrap();
    expect(rows).toHaveLength(2);
  });
});

describe("DrizzleTaskRepository — origin queries", () => {
  it("hasInFlightByOrigin reflects non-terminal status", async () => {
    await save(running(1, "schedule", "s1"));
    expect(
      (await repo.hasInFlightByOrigin({ origin: "schedule", originId: "s1" }))._unsafeUnwrap(),
    ).toBe(true);
    const done = running(1, "schedule", "s1")
      .fail({ kind: "cascade", message: "x" }, { now: CREATED_AT })
      ._unsafeUnwrap();
    await save(done);
    expect(
      (await repo.hasInFlightByOrigin({ origin: "schedule", originId: "s1" }))._unsafeUnwrap(),
    ).toBe(false);
  });

  it("listInFlightByOrigin returns non-terminal tasks for the (origin, originId)", async () => {
    await save(running(1, "workflow", "node-1"));
    const list = (
      await repo.listInFlightByOrigin({ origin: "workflow", originId: "node-1" })
    )._unsafeUnwrap();
    expect(list).toHaveLength(1);
  });

  it("findLatestByOrigin returns the most recent (terminal or not) or null", async () => {
    expect(
      (await repo.findLatestByOrigin({ origin: "workflow", originId: "node-x" }))._unsafeUnwrap(),
    ).toBeNull();
    await save(running(1, "workflow", "node-1"));
    expect(
      (await repo.findLatestByOrigin({ origin: "workflow", originId: "node-1" }))._unsafeUnwrap()
        ?.id,
    ).toBe("20260508-00000001");
  });

  it("deleteTerminalByOrigin removes only terminal rows and returns them", async () => {
    await save(running(1, "schedule", "s1")); // still running
    const done = running(2, "schedule", "s1")
      .complete({ output: null, artifacts: [] }, { now: CREATED_AT })
      ._unsafeUnwrap();
    await save(done);
    const deleted = (
      await repo.deleteTerminalByOrigin({ origin: "schedule", originId: "s1" })
    )._unsafeUnwrap();
    expect(deleted).toHaveLength(1);
    expect((await repo.findById(id(1)))._unsafeUnwrap()).toBeDefined(); // running one kept
    expect((await repo.findById(id(2)))._unsafeUnwrap()).toBeUndefined();
  });

  it("aggregateByOrigin returns per-originId total + running counts", async () => {
    await save(running(1, "schedule", "s1"));
    const done = running(2, "schedule", "s1")
      .complete({ output: null, artifacts: [] }, { now: CREATED_AT })
      ._unsafeUnwrap();
    await save(done);
    const map = (
      await repo.aggregateByOrigin({ origin: "schedule", originIds: ["s1"] })
    )._unsafeUnwrap();
    expect(map.get("s1")).toEqual({ totalCount: 2, runningCount: 1 });
  });
});
