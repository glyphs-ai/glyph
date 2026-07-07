import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListArtifactsUseCase } from "../../src/application/list-artifacts.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { type TaskId, TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";
import { LocalTaskSandbox, tasksRoot } from "../../src/infrastructure/file/local-task-sandbox.js";

const ID: TaskId = TaskIdSchema.parse("20260508-00000001");
const CREATED_AT = "2026-05-08T01:05:00.000Z";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let sandbox: LocalTaskSandbox;
let useCase: ListArtifactsUseCase;
let wsRoot: string;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  wsRoot = mkdtempSync(join(tmpdir(), "task-list-art-"));
  sandbox = new LocalTaskSandbox({ root: tasksRoot(wsRoot) });
  useCase = new ListArtifactsUseCase({ query: new DrizzleTaskQueries({ db }), sandbox });
});

afterEach(() => {
  closeDb();
  rmSync(wsRoot, { recursive: true, force: true });
});

function base(): TaskEntity {
  return TaskEntity.create({
    id: ID,
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt: CREATED_AT,
  });
}

async function seedSucceeded(artifacts: readonly string[]): Promise<void> {
  const entity = base();
  entity.complete({ output: null, artifacts }, { now: CREATED_AT })._unsafeUnwrap();
  (await repo.save(entity))._unsafeUnwrap();
}

function writeArtifact(rel: string, body: string): void {
  const abs = join(sandbox.resolve(ID), "artifact", ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

describe("ListArtifactsUseCase", () => {
  it("lists a succeeded task's artifacts (relPath + size + mtime), sorted", async () => {
    await seedSucceeded(["ref/test.md", "index.html"]);
    writeArtifact("index.html", "<html>");
    writeArtifact("ref/test.md", "hello");

    const res = (await useCase.execute({ id: ID }))._unsafeUnwrap();

    expect(res.map((f) => f.relPath)).toEqual(["index.html", "ref/test.md"]);
    expect(res[0]).toMatchObject({ relPath: "index.html", size: 6 });
    expect(typeof res[1]?.modifiedAt).toBe("string");
  });

  it("returns [] for a running task", async () => {
    (await repo.save(base()))._unsafeUnwrap();

    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toEqual([]);
  });

  it("returns [] for an unknown task", async () => {
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toEqual([]);
  });
});
