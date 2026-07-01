import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { RecoverOrphanedTasksUseCase } from "../../src/application/recover-orphaned-tasks.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";
import { captureLogger } from "./task-fixture.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let useCase: RecoverOrphanedTasksUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new RecoverOrphanedTasksUseCase({
    repository: repo,
    now: () => new Date(CREATED_AT),
    logger: captureLogger().logger,
  });
});

function running(hex: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: "b",
    createdAt: CREATED_AT,
  });
}

describe("RecoverOrphanedTasksUseCase", () => {
  it("marks every running task failed/cascade and persists it", async () => {
    repo.findAll.mockReturnValue(okAsync([running("00000001"), running("00000002")]));
    repo.save.mockReturnValue(okAsync(undefined));
    const res = await useCase.execute({});
    expect(res.isOk()).toBe(true);
    expect(repo.save).toHaveBeenCalledTimes(2);
    const saved = repo.save.mock.calls.map((c) => c[0]);
    expect(saved.every((e) => e.status === "failed" && e.failure?.kind === "cascade")).toBe(true);
  });

  it("surfaces DatabaseUnavailable when the initial list fails", async () => {
    repo.findAll.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: null }));
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
