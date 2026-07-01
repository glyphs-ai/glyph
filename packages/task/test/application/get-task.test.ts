import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskUseCase } from "../../src/application/get-task.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime>;
let useCase: GetTaskUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  useCase = new GetTaskUseCase({ repository: repo, runtimeRegistry });
});

function running(metadata: Record<string, unknown>): TaskEntity {
  return TaskEntity.create({ id: ID, agent: "a", brief: "b", createdAt: CREATED_AT, metadata });
}

describe("GetTaskUseCase", () => {
  it("returns null for an absent task", async () => {
    repo.findById.mockReturnValue(okAsync(undefined));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns a terminal task without touching the runtime", async () => {
    const done = running({})
      .complete({ output: "x", artifacts: [] }, { now: CREATED_AT })
      ._unsafeUnwrap();
    repo.findById.mockReturnValue(okAsync(done));
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res?.status).toBe("succeeded");
    expect(runtimeRegistry.get).not.toHaveBeenCalled();
  });

  it("enriches a running task with lastActiveAtRuntime", async () => {
    repo.findById.mockReturnValue(
      okAsync(running({ runtime: "copilot", runtimeSessionId: "rsid" })),
    );
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readMetadata.mockReturnValue(
      okAsync({ title: null, userTitled: false, lastActiveAt: "2026-05-08T03:00:00.000Z" }),
    );
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res?.metadata.lastActiveAtRuntime).toBe("2026-05-08T03:00:00.000Z");
  });

  it("leaves a running task unenriched when its runtime is unregistered", async () => {
    repo.findById.mockReturnValue(
      okAsync(running({ runtime: "copilot", runtimeSessionId: "rsid" })),
    );
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));
    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(res?.metadata.lastActiveAtRuntime).toBeUndefined();
  });
});
