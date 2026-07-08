import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResolveArtifactPathUseCase } from "../../src/application/resolve-artifact-path.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";
import { LocalTaskSandbox, tasksRoot } from "../../src/infrastructure/file/local-task-sandbox.js";
import { openTestDb } from "../testing.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";
const WS = process.platform === "win32" ? "C:\\ws" : "/ws";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let useCase: ResolveArtifactPathUseCase;

beforeEach(async () => {
  const opened = await openTestDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new ResolveArtifactPathUseCase({
    query: new DrizzleTaskQueries({ db }),
    sandbox: new LocalTaskSandbox({ root: tasksRoot(WS) }),
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
  });
}

function succeeded(artifacts: readonly string[]): TaskEntity {
  const entity = running();
  entity.complete({ output: null, artifacts }, { now: CREATED_AT })._unsafeUnwrap();
  return entity;
}

/** Absolute path the sandbox resolves a relPath to (OS-native separators). */
const abs = (rel: string): string => path.join(tasksRoot(WS), ID, "artifact", ...rel.split("/"));

describe("ResolveArtifactPathUseCase", () => {
  it("resolves a whitelisted nested artifact to its absolute path", async () => {
    await seed(succeeded(["ref/test.md"]));

    const res = (await useCase.execute({ id: ID, relPath: "ref/test.md" }))._unsafeUnwrap();

    expect(res).toBe(abs("ref/test.md"));
  });

  it("distinguishes same-basename artifacts in different dirs", async () => {
    await seed(succeeded(["ref/test.md", "src/test.md"]));

    expect((await useCase.execute({ id: ID, relPath: "ref/test.md" }))._unsafeUnwrap()).toBe(
      abs("ref/test.md"),
    );
    expect((await useCase.execute({ id: ID, relPath: "src/test.md" }))._unsafeUnwrap()).toBe(
      abs("src/test.md"),
    );
  });

  it("resolves a legacy row that stored an absolute path (migration)", async () => {
    // Rows written before the switch to relative storage persisted the
    // absolute path; the read model normalizes it to the same relative
    // identity, so it still resolves.
    await seed(succeeded([abs("ref/test.md")]));

    expect((await useCase.execute({ id: ID, relPath: "ref/test.md" }))._unsafeUnwrap()).toBe(
      abs("ref/test.md"),
    );
  });

  it("returns null for a relative path not on the whitelist", async () => {
    await seed(succeeded(["report.html"]));

    expect((await useCase.execute({ id: ID, relPath: "secret.txt" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a traversal or absolute name", async () => {
    await seed(succeeded(["report.html"]));

    expect((await useCase.execute({ id: ID, relPath: "../secret" }))._unsafeUnwrap()).toBeNull();
    expect((await useCase.execute({ id: ID, relPath: "/etc/passwd" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for a running task", async () => {
    await seed(running());

    expect((await useCase.execute({ id: ID, relPath: "x" }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null for an absent task", async () => {
    expect((await useCase.execute({ id: ID, relPath: "x" }))._unsafeUnwrap()).toBeNull();
  });
});
