import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListInFlightByOriginUseCase } from "../../src/application/list-in-flight-by-origin.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let useCase: ListInFlightByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new ListInFlightByOriginUseCase({ repository: repo });
});

function running(hex: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: "b",
    origin: "workflow",
    originId: "n1",
    createdAt: CREATED_AT,
  });
}

describe("ListInFlightByOriginUseCase", () => {
  it("projects every in-flight entity to a task view", async () => {
    repo.listInFlightByOrigin.mockReturnValue(okAsync([running("00000001"), running("00000002")]));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res.map((t) => t.id)).toEqual(["20260508-00000001", "20260508-00000002"]);
    expect(res[0]).toMatchObject({ origin: "workflow", originId: "n1", status: "running" });
  });

  it("returns an empty array when nothing is in flight", async () => {
    repo.listInFlightByOrigin.mockReturnValue(okAsync([]));
    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toEqual(
      [],
    );
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    repo.listInFlightByOrigin.mockReturnValue(okAsync([]));
    await useCase.execute({ origin: "schedule", originId: "s1" });
    expect(repo.listInFlightByOrigin).toHaveBeenCalledWith({ origin: "schedule", originId: "s1" });
  });
});
