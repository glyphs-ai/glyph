import type { ActivityItem, Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskActivityStreamUseCase } from "../../src/application/get-task-activity-stream.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let runtimeRegistry: MockProxy<RuntimeRegistry>;
let runtime: MockProxy<Runtime & { streamActivity: NonNullable<Runtime["streamActivity"]> }>;
let useCase: GetTaskActivityStreamUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime & { streamActivity: NonNullable<Runtime["streamActivity"]> }>();
  useCase = new GetTaskActivityStreamUseCase({
    query: new DrizzleTaskQueries({ db }),
    runtimeRegistry,
  });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function running(): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
    metadata: { runtime: "copilot", runtimeSessionId: "rsid" },
  });
}

function terminal(): TaskEntity {
  const task = running();
  task.complete({ output: null, artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
  return task;
}

describe("GetTaskActivityStreamUseCase", () => {
  it("returns null for an absent task", async () => {
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a terminal task (nothing left to tail)", async () => {
    await seed(terminal());

    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
    expect(runtimeRegistry.get).not.toHaveBeenCalled();
  });

  it("returns null when the runtime is unregistered", async () => {
    await seed(running());
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));

    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the runtime has no streaming support", async () => {
    await seed(running());
    runtimeRegistry.get.mockReturnValue(ok({ kind: "copilot" } as unknown as Runtime));

    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("resolves to the runtime's stream and forwards after + signal", async () => {
    const iterable: AsyncIterable<ActivityItem> = (async function* () {})();
    const signal = new AbortController().signal;
    await seed(running());
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.streamActivity.mockReturnValue(iterable);

    const res = (await useCase.execute({ id: ID, after: 5, signal }))._unsafeUnwrap();

    expect(res).toBe(iterable);
    expect(runtime.streamActivity).toHaveBeenCalledWith("rsid", { after: 5, signal });
  });
});
