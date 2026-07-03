import { errAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { RecoverOrphanedTasksUseCase } from "../../src/application/recover-orphaned-tasks.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import {
  DrizzleTaskQueries,
  type TaskQueries,
} from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";
import { tasks } from "../../src/infrastructure/drizzle/task-schema.js";
import { captureLogger } from "./task-fixture.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: DrizzleTaskRepository;
let query: DrizzleTaskQueries;
let useCase: RecoverOrphanedTasksUseCase;

beforeEach(() => {
  const { db } = openDb(":memory:");
  repo = new DrizzleTaskRepository({ db });
  query = new DrizzleTaskQueries({ db });
  useCase = new RecoverOrphanedTasksUseCase({
    repository: repo,
    query,
    now: () => new Date(CREATED_AT),
    logger: captureLogger().logger,
  });
});

function running(hex: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
  });
}

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

async function statusOf(hex: string): Promise<TaskEntity> {
  return (await repo.get(TaskIdSchema.parse(`20260508-${hex}`)))._unsafeUnwrap();
}

describe("RecoverOrphanedTasksUseCase", () => {
  it("marks every running task failed/cascade and persists it", async () => {
    await seed(running("00000001"));
    await seed(running("00000002"));

    const res = await useCase.execute({});
    expect(res.isOk()).toBe(true);

    const a = await statusOf("00000001");
    const b = await statusOf("00000002");
    expect(a.status).toBe("failed");
    expect(a.failure?.kind).toBe("cascade");
    expect(b.status).toBe("failed");
    expect(b.failure?.kind).toBe("cascade");
  });

  it("only sweeps running tasks — already-terminal tasks are left untouched", async () => {
    const done = running("00000003");
    done.complete({ output: "ok", artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
    await seed(done);

    await useCase.execute({});

    const reread = await statusOf("00000003");
    expect(reread.status).toBe("succeeded");
    expect(reread.success?.output).toBe("ok");
  });

  it("surfaces DatabaseUnavailable when the initial running-scan fails", async () => {
    const failingQuery = {
      tasks,
      query: () => errAsync({ type: "DatabaseUnavailable" as const, cause: null }),
    } as unknown as TaskQueries;
    const uc = new RecoverOrphanedTasksUseCase({
      repository: repo,
      query: failingQuery,
      now: () => new Date(CREATED_AT),
      logger: captureLogger().logger,
    });
    expect((await uc.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
