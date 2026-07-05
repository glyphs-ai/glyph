import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DeleteTaskUseCase } from "../../src/application/delete-task.js";
import type { TaskSupervisor } from "../../src/application/supervision/task-supervisor.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
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
  const t = TaskEntity.create({
    id: ID,
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
  });
  t.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return t;
}

function runningTask(): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
  });
}

describe("DeleteTaskUseCase", () => {
  it("deletes a terminal task without purging by default", async () => {
    repo.get.mockReturnValue(okAsync(terminal()));
    repo.delete.mockReturnValue(okAsync(undefined));
    const res = await useCase.execute({ id: ID });
    expect(res.isOk()).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith(ID);
    expect(supervisor.purge).not.toHaveBeenCalled();
  });

  it("purges physical resources BEFORE deleting the row when purge: true", async () => {
    const done = terminal();
    repo.get.mockReturnValue(okAsync(done));
    supervisor.purge.mockReturnValue(okAsync(undefined));
    repo.delete.mockReturnValue(okAsync(undefined));
    const res = await useCase.execute({ id: ID, purge: true });
    expect(res.isOk()).toBe(true);
    expect(supervisor.purge).toHaveBeenCalledWith(done);
    expect(repo.delete).toHaveBeenCalledWith(ID);
    // The row is the durable journal: purge must complete before the row is removed.
    const purgeOrder = supervisor.purge.mock.invocationCallOrder.at(0) ?? 0;
    const deleteOrder = repo.delete.mock.invocationCallOrder.at(0) ?? 0;
    expect(purgeOrder).toBeGreaterThan(0);
    expect(deleteOrder).toBeGreaterThan(purgeOrder);
  });

  it("keeps the row (no delete) and surfaces PurgeFailed when purge fails", async () => {
    repo.get.mockReturnValue(okAsync(terminal()));
    supervisor.purge.mockReturnValue(
      errAsync({ type: "PurgeFailed", taskId: ID, cause: new Error("rm") }),
    );
    const e = (await useCase.execute({ id: ID, purge: true }))._unsafeUnwrapErr();
    expect(e.type).toBe("PurgeFailed");
    expect(repo.delete).not.toHaveBeenCalled();
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
