import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DeleteTaskUseCase } from "../../src/application/delete-task.js";
import type { TaskSupervisor } from "../../src/application/supervision/index.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let supervisor: MockProxy<TaskSupervisor>;
let useCase: DeleteTaskUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  supervisor = mock<TaskSupervisor>();
  useCase = new DeleteTaskUseCase({ repository: repo, supervisor });
});

function terminal(): TaskEntity {
  return TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT })
    .complete({ output: null, artifacts: [] }, { now: CREATED_AT })
    ._unsafeUnwrap();
}

function runningTask(): TaskEntity {
  return TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT });
}

describe("DeleteTaskUseCase", () => {
  it("deletes a terminal task without enqueuing a purge by default", async () => {
    repo.get.mockReturnValue(okAsync(terminal()));
    repo.delete.mockReturnValue(okAsync(undefined));
    const res = await useCase.execute({ id: ID });
    expect(res.isOk()).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith(ID);
    expect(supervisor.enqueuePurge).not.toHaveBeenCalled();
  });

  it("enqueues a background purge when purge: true", async () => {
    const done = terminal();
    repo.get.mockReturnValue(okAsync(done));
    repo.delete.mockReturnValue(okAsync(undefined));
    await useCase.execute({ id: ID, purge: true });
    expect(supervisor.enqueuePurge).toHaveBeenCalledWith(done);
  });

  it("rejects deleting a non-terminal task with InvalidTransition", async () => {
    repo.get.mockReturnValue(okAsync(runningTask()));
    const e = (await useCase.execute({ id: ID }))._unsafeUnwrapErr();
    expect(e.type).toBe("InvalidTransition");
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("propagates TaskNotFound from the repository", async () => {
    repo.get.mockReturnValue(errAsync({ type: "TaskNotFound", id: ID }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("TaskNotFound");
  });
});
