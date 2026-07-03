import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HasInFlightByOriginUseCase } from "../../src/application/has-in-flight-by-origin.js";
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
let useCase: HasInFlightByOriginUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new HasInFlightByOriginUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function task(hex: string, origin: string, originId: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    origin,
    originId,
    createdAt: CREATED_AT,
  });
}

function terminal(hex: string, origin: string, originId: string): TaskEntity {
  const entity = task(hex, origin, originId);
  entity.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return entity;
}

describe("HasInFlightByOriginUseCase", () => {
  it("returns true when the repository reports an in-flight task", async () => {
    await seed(task("00000001", "workflow", "n1"));

    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toBe(
      true,
    );
  });

  it("returns false when the repository reports none", async () => {
    await seed(terminal("00000001", "workflow", "n1"));
    await seed(task("00000002", "workflow", "n2"));
    await seed(task("00000003", "schedule", "n1"));

    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toBe(
      false,
    );
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    await seed(task("00000001", "schedule", "s7"));
    await seed(task("00000002", "workflow", "s7"));

    expect((await useCase.execute({ origin: "schedule", originId: "s7" }))._unsafeUnwrap()).toBe(
      true,
    );
  });
});
