import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListTasksUseCase } from "../../src/application/list-tasks.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

let repo: MockProxy<TaskRepository>;
let useCase: ListTasksUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new ListTasksUseCase({ repository: repo });
});

function at(hex: string, createdAt: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: "b",
    createdAt,
  });
}

describe("ListTasksUseCase", () => {
  it("returns tasks newest-first (createdAt desc, id desc tiebreak)", async () => {
    const older = at("00000001", "2026-05-08T01:00:00.000Z");
    const newer = at("00000002", "2026-05-08T02:00:00.000Z");
    repo.findAll.mockReturnValue(okAsync([older, newer]));
    const res = (await useCase.execute({}))._unsafeUnwrap();
    expect(res.map((t) => t.id)).toEqual(["20260508-00000002", "20260508-00000001"]);
  });

  it("forwards only the present filters to the repository", async () => {
    repo.findAll.mockReturnValue(okAsync([]));
    await useCase.execute({ agent: "x", statuses: ["running"] });
    expect(repo.findAll).toHaveBeenCalledWith({ agent: "x", statuses: ["running"] });
  });
});
