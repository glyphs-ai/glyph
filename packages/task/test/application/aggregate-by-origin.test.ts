import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AggregateByOriginUseCase } from "../../src/application/aggregate-by-origin.js";
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
let useCase: AggregateByOriginUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new AggregateByOriginUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function running(hex: string, originId: string, origin = "workflow"): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    origin,
    originId,
    createdAt: CREATED_AT,
  });
}

function terminal(hex: string, originId: string, origin = "workflow"): TaskEntity {
  const entity = running(hex, originId, origin);
  entity.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return entity;
}

describe("AggregateByOriginUseCase", () => {
  it("returns the per-originId aggregate map from the repository", async () => {
    await seed(running("00000001", "n1"));
    await seed(terminal("00000002", "n1"));
    await seed(terminal("00000003", "n1"));
    await seed(running("00000004", "n2"));
    await seed(running("00000005", "n1", "schedule"));

    const res = (await useCase.execute({ origin: "workflow", originIds: ["n1"] }))._unsafeUnwrap();

    expect(res.get("n1")).toEqual({ totalCount: 3, runningCount: 1 });
    expect(res.has("n2")).toBe(false);
  });

  it("omits statusIn from the repository call when not supplied", async () => {
    await seed(running("00000001", "n1"));
    await seed(terminal("00000002", "n1"));
    await seed(running("00000003", "n2"));

    const res = (
      await useCase.execute({ origin: "workflow", originIds: ["n1", "n2"] })
    )._unsafeUnwrap();

    expect(res.get("n1")).toEqual({ totalCount: 2, runningCount: 1 });
    expect(res.get("n2")).toEqual({ totalCount: 1, runningCount: 1 });
  });

  it("forwards statusIn to the repository when supplied", async () => {
    await seed(running("00000001", "n1"));
    await seed(terminal("00000002", "n1"));

    const res = (
      await useCase.execute({ origin: "workflow", originIds: ["n1"], statusIn: ["running"] })
    )._unsafeUnwrap();

    expect(res.get("n1")).toEqual({ totalCount: 1, runningCount: 1 });
  });
});
