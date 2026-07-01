import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { CancelTaskUseCase } from "../../src/application/cancel-task.js";
import type { TaskSupervisor } from "../../src/application/supervision/index.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let supervisor: MockProxy<TaskSupervisor>;
let useCase: CancelTaskUseCase;

beforeEach(() => {
  supervisor = mock<TaskSupervisor>();
  useCase = new CancelTaskUseCase({ supervisor });
});

describe("CancelTaskUseCase", () => {
  it("delegates to the supervisor and projects the cancelled DTO", async () => {
    const cancelled = TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT })
      .cancel({ kind: "user", message: "stop" }, { now: CREATED_AT })
      ._unsafeUnwrap();
    supervisor.cancel.mockReturnValue(okAsync(cancelled));
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res.status).toBe("cancelled");
    expect(supervisor.cancel).toHaveBeenCalledWith(ID);
  });

  it("propagates a supervisor error verbatim", async () => {
    supervisor.cancel.mockReturnValue(
      errAsync({ type: "InvalidTransition", from: "succeeded", eventType: "cancel" }),
    );
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("InvalidTransition");
  });
});
