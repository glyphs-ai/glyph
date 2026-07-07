import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskBriefSchema } from "../../../src/domain/task-brief.js";
import { TaskEntity } from "../../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../../src/domain/task-id.js";
import type { Db } from "../../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskRepository } from "../../../src/infrastructure/drizzle/task-repository.js";
import { tasks } from "../../../src/infrastructure/drizzle/task-schema.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;

beforeEach(async () => {
  ({ db, close: closeDb } = await openDb(":memory:"));
  repo = new DrizzleTaskRepository({ db });
});

afterEach(() => {
  closeDb();
});

function id(n: number): TaskId {
  return TaskIdSchema.parse(`20260508-${n.toString(16).padStart(8, "0")}`);
}

function running(n: number, origin = "standalone", originId?: string): TaskEntity {
  return TaskEntity.create({
    id: id(n),
    agent: "public/demo",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
    origin,
    ...(originId !== undefined ? { originId } : {}),
    metadata: { runtime: "copilot" },
  });
}

function terminal(n: number, origin: string, originId: string): TaskEntity {
  const t = running(n, origin, originId);
  t.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return t;
}

async function save(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

describe("DrizzleTaskRepository — get / save / delete", () => {
  it("saves (insert) then reads back a task by id", async () => {
    await save(running(1));
    const found = (await repo.get(id(1)))._unsafeUnwrap();
    expect(found.id).toBe("20260508-00000001");
    expect(found.metadata).toEqual({ runtime: "copilot" });
  });

  it("get returns TaskNotFound for an absent id", async () => {
    expect((await repo.get(id(99)))._unsafeUnwrapErr().type).toBe("TaskNotFound");
  });

  it("save on a tracked (loaded) entity UPDATEs it in place", async () => {
    await save(running(1));
    const loaded = (await repo.get(id(1)))._unsafeUnwrap();
    loaded.complete({ output: "x", artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();
    const reread = (await repo.get(id(1)))._unsafeUnwrap();
    expect(reread.status).toBe("succeeded");
    expect(reread.success?.output).toBe("x");
  });

  it("save is a no-op when a loaded entity has no changes", async () => {
    await save(running(1));
    const loaded = (await repo.get(id(1)))._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();
    const reread = (await repo.get(id(1)))._unsafeUnwrap();
    expect(reread.status).toBe("running");
  });

  it("delete removes the row so get returns TaskNotFound", async () => {
    await save(running(1));
    (await repo.delete(id(1)))._unsafeUnwrap();
    expect((await repo.get(id(1)))._unsafeUnwrapErr().type).toBe("TaskNotFound");
  });
});

describe("DrizzleTaskRepository — listTerminalByOrigin", () => {
  it("returns only TERMINAL tasks for the (origin, originId)", async () => {
    await save(running(1, "schedule", "s1")); // running — excluded
    await save(terminal(2, "schedule", "s1")); // terminal — included
    await save(terminal(3, "schedule", "s2")); // other originId — excluded
    const list = (
      await repo.listTerminalByOrigin({ origin: "schedule", originId: "s1" })
    )._unsafeUnwrap();
    expect(list.map((t) => t.id)).toEqual(["20260508-00000002"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const list = (
      await repo.listTerminalByOrigin({ origin: "workflow", originId: "none" })
    )._unsafeUnwrap();
    expect(list).toEqual([]);
  });

  it("returns TRACKED entities — a subsequent save UPDATEs (no INSERT/PK conflict)", async () => {
    await save(terminal(2, "schedule", "s1"));
    const list = (
      await repo.listTerminalByOrigin({ origin: "schedule", originId: "s1" })
    )._unsafeUnwrap();
    const t = list[0];
    if (t === undefined) throw new Error("expected one terminal task");
    // If the finder returned untracked entities, this save would attempt an
    // INSERT and hit a PK conflict. Tracked ⇒ it diffs + UPDATEs.
    t.replaceMetadata({ runtime: "copilot", tag: "x" });
    (await repo.save(t))._unsafeUnwrap();
    const reread = (await repo.get(id(2)))._unsafeUnwrap();
    expect(reread.metadata.tag).toBe("x");
  });

  it("warn-skips a corrupted terminal row so it is never surfaced for deletion", async () => {
    // A terminal row with no success payload fails reconstruction. Insert it
    // raw (bypassing the mapper) to simulate on-disk corruption.
    await db
      .insert(tasks)
      .values({
        id: "20260508-00000009",
        agent: "a",
        runtime: null,
        status: "succeeded",
        brief: "b",
        details: null,
        origin: "schedule",
        originId: "s1",
        createdAt: CREATED_AT,
        startedAt: CREATED_AT,
        endedAt: CREATED_AT,
        success: null,
        failure: null,
        cancellation: null,
        metadata: "{}",
      })
      .run();
    const list = (
      await repo.listTerminalByOrigin({ origin: "schedule", originId: "s1" })
    )._unsafeUnwrap();
    expect(list).toEqual([]);
  });
});
