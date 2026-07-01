import type { ActivityItem, Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, ok, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskActivityStreamUseCase } from "../../src/application/get-task-activity-stream.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { TaskRepository } from "../../src/domain/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let repo: MockProxy<TaskRepository>;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime & { streamActivity: NonNullable<Runtime["streamActivity"]> }>;
let useCase: GetTaskActivityStreamUseCase;

beforeEach(() => {
  repo = mock<TaskRepository>();
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime & { streamActivity: NonNullable<Runtime["streamActivity"]> }>();
  useCase = new GetTaskActivityStreamUseCase({ repository: repo, runtimeRegistry });
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

function terminal(): TaskEntity {
  return running().complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
}

describe("GetTaskActivityStreamUseCase", () => {
  it("returns null for an absent task", async () => {
    repo.findById.mockReturnValue(okAsync(undefined));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a terminal task (nothing left to tail)", async () => {
    repo.findById.mockReturnValue(okAsync(terminal()));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
    expect(runtimeRegistry.get).not.toHaveBeenCalled();
  });

  it("returns null when the runtime is unregistered", async () => {
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the runtime has no streaming support", async () => {
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(ok({ kind: "copilot" } as unknown as Runtime));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("resolves to the runtime's stream and forwards after + signal", async () => {
    const iterable: AsyncIterable<ActivityItem> = (async function* () {})();
    const signal = new AbortController().signal;
    repo.findById.mockReturnValue(okAsync(running()));
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.streamActivity.mockReturnValue(iterable);
    const res = (await useCase.execute({ id: ID, after: 5, signal }))._unsafeUnwrap();
    expect(res).toBe(iterable);
    expect(runtime.streamActivity).toHaveBeenCalledWith("rsid", { after: 5, signal });
  });
});
