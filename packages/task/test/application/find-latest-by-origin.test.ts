import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FindLatestByOriginUseCase } from "../../src/application/find-latest-by-origin.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let useCase: FindLatestByOriginUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new FindLatestByOriginUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function running(hex: string, createdAt: string, origin = "workflow", originId = "n1"): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "public/demo",
    brief: TaskBriefSchema.parse("do it"),
    origin,
    originId,
    createdAt,
  });
}

describe("FindLatestByOriginUseCase", () => {
  it("returns null when no task matches the origin", async () => {
    await seed(running("00000001", "2026-05-08T01:05:00.000Z", "workflow", "n2"));

    expect(
      (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap(),
    ).toBeNull();
  });

  it("projects the matched entity to a task view", async () => {
    await seed(running("00000001", "2026-05-08T01:05:00.000Z"));
    await seed(running("00000002", "2026-05-08T02:05:00.000Z"));

    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();

    expect(res).toMatchObject({
      id: "20260508-00000002",
      agent: "public/demo",
      brief: "do it",
      origin: "workflow",
      originId: "n1",
      status: "running",
    });
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    await seed(running("00000001", "2026-05-08T01:05:00.000Z", "schedule", "s9"));
    await seed(running("00000002", "2026-05-08T02:05:00.000Z", "workflow", "s9"));

    const res = (await useCase.execute({ origin: "schedule", originId: "s9" }))._unsafeUnwrap();

    expect(res?.id).toBe("20260508-00000001");
  });
});
