import type { Runtime, RuntimeRegistry } from "@glyphs-ai/runtime";
import { err, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetTaskUseCase } from "../../src/application/get-task.js";
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
let runtime: MockProxy<Runtime>;
let useCase: GetTaskUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  runtimeRegistry = mock<RuntimeRegistry>();
  runtime = mock<Runtime>();
  useCase = new GetTaskUseCase({ query: new DrizzleTaskQueries({ db }), runtimeRegistry });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function running(metadata: Record<string, unknown>): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
    metadata,
  });
}

describe("GetTaskUseCase", () => {
  it("returns null for an absent task", async () => {
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns a terminal task without touching the runtime", async () => {
    const done = running({});
    done.complete({ output: "x", artifacts: [] }, { now: CREATED_AT })._unsafeUnwrap();
    await seed(done);

    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();

    expect(res?.status).toBe("succeeded");
    expect(runtimeRegistry.get).not.toHaveBeenCalled();
  });

  it("enriches a running task with lastActiveAtRuntime", async () => {
    await seed(running({ runtime: "copilot", runtimeSessionId: "rsid" }));
    runtimeRegistry.get.mockReturnValue(ok(runtime));
    runtime.readMetadata.mockReturnValue(
      okAsync({ title: null, userTitled: false, lastActiveAt: "2026-05-08T03:00:00.000Z" }),
    );

    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();

    expect(res?.metadata.lastActiveAtRuntime).toBe("2026-05-08T03:00:00.000Z");
  });

  it("leaves a running task unenriched when its runtime is unregistered", async () => {
    await seed(running({ runtime: "copilot", runtimeSessionId: "rsid" }));
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));

    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();

    expect(res?.metadata.lastActiveAtRuntime).toBeUndefined();
  });
});
