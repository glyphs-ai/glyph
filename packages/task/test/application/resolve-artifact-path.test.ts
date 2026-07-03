import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResolveArtifactPathUseCase } from "../../src/application/resolve-artifact-path.js";
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
let useCase: ResolveArtifactPathUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new ResolveArtifactPathUseCase({ query: new DrizzleTaskQueries({ db }) });
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
  });
}

function succeeded(artifacts: readonly string[]): TaskEntity {
  const entity = running();
  entity.complete({ output: null, artifacts }, { now: CREATED_AT })._unsafeUnwrap();
  return entity;
}

describe("ResolveArtifactPathUseCase", () => {
  it("resolves a whitelisted artifact by basename", async () => {
    await seed(succeeded(["/w/artifact/report.html"]));

    const res = (await useCase.execute({ id: ID, name: "report.html" }))._unsafeUnwrap();

    expect(res).toBe("/w/artifact/report.html");
  });

  it("returns null for a name not on the whitelist", async () => {
    await seed(succeeded(["/w/artifact/report.html"]));

    expect((await useCase.execute({ id: ID, name: "secret.txt" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a running task", async () => {
    await seed(running());

    expect((await useCase.execute({ id: ID, name: "x" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for an absent task", async () => {
    expect((await useCase.execute({ id: ID, name: "x" }))._unsafeUnwrap()).toBeNull();
  });
});
