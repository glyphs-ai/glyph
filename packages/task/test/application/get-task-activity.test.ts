import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskActivityUseCase } from "../../src/application/get-task-activity.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime & { readActivity: NonNullable<Runtime["readActivity"]> }>;
let useCase: GetTaskActivityUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime & { readActivity: NonNullable<Runtime["readActivity"]> }>();
  useCase = new GetTaskActivityUseCase({ repository: repo, runtimeRegistry });
});

function running(): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "a",
    brief: "b",
    createdAt: CREATED_AT,
    metadata: { runtime: "copilot", runtimeSessionId: "rsid" },
  });
}

describe("GetTaskActivityUseCase", () => {
  it("returns null for an absent task", async () => {
    repo.findById.mockReturnValue(okAsync(undefined));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the runtime is unregistered", async () => {
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("forwards the paging opts to the runtime's readActivity", async () => {
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readActivity.mockReturnValue(okAsync(null));
    const res = await useCase.execute({ id: ID, limit: 10 });
    expect(res.isOk()).toBe(true);
    expect(runtime.readActivity).toHaveBeenCalledWith("rsid", { limit: 10 });
  });

  it("propagates a genuine read fault as RuntimeActivityReadFailed", async () => {
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readActivity.mockReturnValue(
      errAsync({ type: "RuntimeActivityReadFailed", cause: null }),
    );
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe(
      "RuntimeActivityReadFailed",
    );
  });
});
