import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { DeleteTerminalByOriginUseCase } from "../../src/application/delete-terminal-by-origin.js";
import type { TaskSupervisor } from "../../src/application/supervision/task-supervisor.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";
import { captureLogger } from "./task-fixture.js";

const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let supervisor: MockProxy<TaskSupervisor>;
let useCase: DeleteTerminalByOriginUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  supervisor = mock<TaskSupervisor>();
  useCase = new DeleteTerminalByOriginUseCase({
    repository: repo,
    supervisor,
    logger: captureLogger().logger,
  });
});

function terminal(hex: string): TaskEntity {
  const t = TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    origin: "workflow",
    originId: "n1",
    createdAt: CREATED_AT,
  });
  t.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return t;
}

describe("DeleteTerminalByOriginUseCase", () => {
  it("purges then deletes each terminal task and returns the count", async () => {
    const a = terminal("00000001");
    const b = terminal("00000002");
    repo.listTerminalByOrigin.mockReturnValue(okAsync([a, b]));
    supervisor.purge.mockReturnValue(okAsync(undefined));
    repo.delete.mockReturnValue(okAsync(undefined));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toEqual({ deletedCount: 2 });
    expect(supervisor.purge).toHaveBeenCalledWith(a);
    expect(supervisor.purge).toHaveBeenCalledWith(b);
    expect(supervisor.purge).toHaveBeenCalledTimes(2);
    expect(repo.delete).toHaveBeenCalledTimes(2);
  });

  it("returns zero and purges nothing when no terminal task matches", async () => {
    repo.listTerminalByOrigin.mockReturnValue(okAsync([]));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toEqual({ deletedCount: 0 });
    expect(supervisor.purge).not.toHaveBeenCalled();
  });

  it("skips a task whose purge fails — not deleted, not counted", async () => {
    const a = terminal("00000001");
    const b = terminal("00000002");
    repo.listTerminalByOrigin.mockReturnValue(okAsync([a, b]));
    supervisor.purge.mockImplementation((t) =>
      t.id === a.id
        ? errAsync({ type: "PurgeFailed", taskId: a.id, cause: null })
        : okAsync(undefined),
    );
    repo.delete.mockReturnValue(okAsync(undefined));
    const res = (await useCase.execute({ origin: "workflow", originId: "n1" }))._unsafeUnwrap();
    expect(res).toEqual({ deletedCount: 1 });
    expect(repo.delete).toHaveBeenCalledWith(b.id);
    expect(repo.delete).toHaveBeenCalledTimes(1);
  });

  it("forwards the (origin, originId) verbatim to the repository finder", async () => {
    repo.listTerminalByOrigin.mockReturnValue(okAsync([]));
    await useCase.execute({ origin: "schedule", originId: "s3" });
    expect(repo.listTerminalByOrigin).toHaveBeenCalledWith({ origin: "schedule", originId: "s3" });
  });
});
