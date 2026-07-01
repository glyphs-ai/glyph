import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { AggregateByOriginUseCase } from "../../src/application/aggregate-by-origin.js";
import type { OriginAggregate, TaskRepository } from "../../src/domain/task-repository.js";

let repo: MockProxy<TaskRepository>;
let useCase: AggregateByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new AggregateByOriginUseCase({ repository: repo });
});

describe("AggregateByOriginUseCase", () => {
  it("returns the per-originId aggregate map from the repository", async () => {
    const map: ReadonlyMap<string, OriginAggregate> = new Map([
      ["n1", { totalCount: 3, runningCount: 1 }],
    ]);
    repo.aggregateByOrigin.mockReturnValue(okAsync(map));
    const res = (await useCase.execute({ origin: "workflow", originIds: ["n1"] }))._unsafeUnwrap();
    expect(res.get("n1")).toEqual({ totalCount: 3, runningCount: 1 });
  });

  it("omits statusIn from the repository call when not supplied", async () => {
    repo.aggregateByOrigin.mockReturnValue(okAsync(new Map()));
    await useCase.execute({ origin: "workflow", originIds: ["n1", "n2"] });
    expect(repo.aggregateByOrigin).toHaveBeenCalledWith({
      origin: "workflow",
      originIds: ["n1", "n2"],
    });
  });

  it("forwards statusIn to the repository when supplied", async () => {
    repo.aggregateByOrigin.mockReturnValue(okAsync(new Map()));
    await useCase.execute({ origin: "workflow", originIds: ["n1"], statusIn: ["running"] });
    expect(repo.aggregateByOrigin).toHaveBeenCalledWith({
      origin: "workflow",
      originIds: ["n1"],
      statusIn: ["running"],
    });
  });
});
