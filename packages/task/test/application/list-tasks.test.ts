import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListTasksUseCase } from "../../src/application/list-tasks.js";
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
let useCase: ListTasksUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new ListTasksUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function at(
  hex: string,
  createdAt: string,
  overrides: Partial<Parameters<typeof TaskEntity.create>[0]> = {},
): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt,
    ...overrides,
  });
}

describe("ListTasksUseCase", () => {
  it("returns tasks newest-first (createdAt desc, id desc tiebreak)", async () => {
    await seed(at("00000001", "2026-05-08T01:00:00.000Z"));
    await seed(at("00000002", "2026-05-08T02:00:00.000Z"));
    await seed(at("00000003", "2026-05-08T02:00:00.000Z"));

    const res = (await useCase.execute({}))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual([
      "20260508-00000003",
      "20260508-00000002",
      "20260508-00000001",
    ]);
  });

  it("forwards only the present filters to the repository", async () => {
    await seed(at("00000001", "2026-05-08T01:00:00.000Z", { agent: "x" }));
    await seed(at("00000002", "2026-05-08T01:00:00.000Z", { agent: "other" }));
    const terminal = at("00000003", "2026-05-08T01:00:00.000Z", { agent: "x" });
    terminal
      .complete({ output: "done", artifacts: [] }, { now: "2026-05-08T02:00:00.000Z" })
      ._unsafeUnwrap();
    await seed(terminal);

    const res = (await useCase.execute({ agent: "x", status: "running" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000001"]);
  });
});
