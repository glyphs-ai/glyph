import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListInFlightByOriginUseCase } from "../../src/application/list-in-flight-by-origin.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let useCase: ListInFlightByOriginUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new ListInFlightByOriginUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function running(hex: string, origin = "workflow", originId = "n1"): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    origin,
    originId,
    createdAt: CREATED_AT,
  });
}

function terminal(hex: string, origin = "workflow", originId = "n1"): TaskEntity {
  const entity = running(hex, origin, originId);
  entity.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return entity;
}

describe("ListInFlightByOriginUseCase", () => {
  it("projects every in-flight entity to a task view", async () => {
    await seed(running("00000001"));
    await seed(running("00000002"));
    await seed(terminal("00000003"));
    await seed(running("00000004", "workflow", "n2"));
    await seed(running("00000005", "schedule", "n1"));

    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000001", "20260508-00000002"]);
    expect(res[0]).toMatchObject({ origin: "workflow", originId: "n1", status: "running" });
  });

  it("returns an empty array when nothing is in flight", async () => {
    await seed(terminal("00000001"));
    await seed(running("00000002", "workflow", "n2"));

    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toEqual(
      [],
    );
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    await seed(running("00000001", "schedule", "s1"));
    await seed(running("00000002", "workflow", "s1"));

    const res = (await useCase.execute({ origin: "schedule", originId: "s1" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000001"]);
  });
});
