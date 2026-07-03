import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskActivityUseCase } from "../../src/application/get-task-activity.js";
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
let runtime: MockProxy<Runtime & { readActivity: NonNullable<Runtime["readActivity"]> }>;
let useCase: GetTaskActivityUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime & { readActivity: NonNullable<Runtime["readActivity"]> }>();
  useCase = new GetTaskActivityUseCase({ query: new DrizzleTaskQueries({ db }), runtimeRegistry });
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

describe("GetTaskActivityUseCase", () => {
  it("returns null for an absent task", async () => {
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the runtime is unregistered", async () => {
    await seed(running());
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));

    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("forwards the paging opts to the runtime's readActivity", async () => {
    await seed(running());
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readActivity.mockReturnValue(okAsync(null));

    const res = await useCase.execute({ id: ID, limit: 10 });

    expect(res.isOk()).toBe(true);
    expect(runtime.readActivity).toHaveBeenCalledWith("rsid", { limit: 10 });
  });

  it("propagates a genuine read fault as RuntimeActivityReadFailed", async () => {
    await seed(running());
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readActivity.mockReturnValue(
      errAsync({ type: "RuntimeActivityReadFailed", cause: null }),
    );

    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe(
      "RuntimeActivityReadFailed",
    );
  });
});
