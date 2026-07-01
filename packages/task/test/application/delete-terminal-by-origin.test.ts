import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DeleteTerminalByOriginUseCase } from "../../src/application/delete-terminal-by-origin.js";
import type { TaskSupervisor } from "../../src/application/supervision/index.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let supervisor: MockProxy<TaskSupervisor>;
let useCase: DeleteTerminalByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  supervisor = mock<TaskSupervisor>();
  useCase = new DeleteTerminalByOriginUseCase({ repository: repo, supervisor });
});

function terminal(hex: string): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: "b",
    origin: "workflow",
    originId: "n1",
    createdAt: CREATED_AT,
  })
    .complete({ output: null, artifacts: [] }, { now: CREATED_AT })
    ._unsafeUnwrap();
}

describe("DeleteTerminalByOriginUseCase", () => {
  it("returns the deleted count and enqueues a purge for each deleted task", async () => {
    const a = terminal("00000001");
    const b = terminal("00000002");
    repo.deleteTerminalByOrigin.mockReturnValue(okAsync([a, b]));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toEqual({ deletedCount: 2 });
    expect(supervisor.enqueuePurge).toHaveBeenCalledWith(a);
    expect(supervisor.enqueuePurge).toHaveBeenCalledWith(b);
    expect(supervisor.enqueuePurge).toHaveBeenCalledTimes(2);
  });

  it("returns zero and enqueues nothing when no terminal task matches", async () => {
    repo.deleteTerminalByOrigin.mockReturnValue(okAsync([]));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toEqual({ deletedCount: 0 });
    expect(supervisor.enqueuePurge).not.toHaveBeenCalled();
  });

  it("forwards the (origin, originId) verbatim to the repository", async () => {
    repo.deleteTerminalByOrigin.mockReturnValue(okAsync([]));
    await useCase.execute({ origin: "schedule", originId: "s3" });
    expect(repo.deleteTerminalByOrigin).toHaveBeenCalledWith({
      origin: "schedule",
      originId: "s3",
    });
  });
});
