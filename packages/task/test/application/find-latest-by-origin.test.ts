import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { FindLatestByOriginUseCase } from "../../src/application/find-latest-by-origin.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let useCase: FindLatestByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new FindLatestByOriginUseCase({ repository: repo });
});

function running(): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse("20260508-00000001"),
    agent: "public/demo",
    brief: "do it",
    origin: "workflow",
    originId: "n1",
    createdAt: CREATED_AT,
  });
}

describe("FindLatestByOriginUseCase", () => {
  it("returns null when no task matches the origin", async () => {
    repo.findLatestByOrigin.mockReturnValue(okAsync(null));
    expect(
      (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap(),
    ).toBeNull();
  });

  it("projects the matched entity to a task view", async () => {
    repo.findLatestByOrigin.mockReturnValue(okAsync(running()));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toMatchObject({
      id: "20260508-00000001",
      agent: "public/demo",
      brief: "do it",
      origin: "workflow",
      originId: "n1",
      status: "running",
    });
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    repo.findLatestByOrigin.mockReturnValue(okAsync(null));
    await useCase.execute({ origin: "schedule", originId: "s9" });
    expect(repo.findLatestByOrigin).toHaveBeenCalledWith({ origin: "schedule", originId: "s9" });
  });
});
