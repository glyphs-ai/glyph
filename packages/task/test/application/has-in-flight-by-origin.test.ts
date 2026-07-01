import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { HasInFlightByOriginUseCase } from "../../src/application/has-in-flight-by-origin.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

let repo: MockProxy<TaskRepository>;
let useCase: HasInFlightByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  useCase = new HasInFlightByOriginUseCase({ repository: repo });
});

describe("HasInFlightByOriginUseCase", () => {
  it("returns true when the repository reports an in-flight task", async () => {
    repo.hasInFlightByOrigin.mockReturnValue(okAsync(true));
    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toBe(
      true,
    );
  });

  it("returns false when the repository reports none", async () => {
    repo.hasInFlightByOrigin.mockReturnValue(okAsync(false));
    expect((await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap()).toBe(
      false,
    );
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    repo.hasInFlightByOrigin.mockReturnValue(okAsync(false));
    await useCase.execute({ origin: "schedule", originId: "s7" });
    expect(repo.hasInFlightByOrigin).toHaveBeenCalledWith({ origin: "schedule", originId: "s7" });
  });
});
