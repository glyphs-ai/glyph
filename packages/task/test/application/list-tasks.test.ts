import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListTasksUseCase } from "../../src/application/list-tasks.js";
import { TaskBriefSchema } from "../../src/domain/task-brief.js";
import { TaskEntity } from "../../src/domain/task-entity.js";
import { TaskIdSchema } from "../../src/domain/task-id.js";
import type { Db } from "../../src/infrastructure/drizzle/task-db.js";
import { openDb } from "../../src/infrastructure/drizzle/task-db.js";
import { DrizzleTaskQueries } from "../../src/infrastructure/drizzle/task-queries.js";
import { DrizzleTaskRepository } from "../../src/infrastructure/drizzle/task-repository.js";

let db: Db;
let closeDb: () => void = () => {};
let repo: DrizzleTaskRepository;
let useCase: ListTasksUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  closeDb = opened.close;
  repo = new DrizzleTaskRepository({ db });
  useCase = new ListTasksUseCase({ query: new DrizzleTaskQueries({ db }) });
});

afterEach(() => {
  closeDb();
});

async function seed(entity: TaskEntity): Promise<void> {
  (await repo.save(entity))._unsafeUnwrap();
}

function at(
  hex: string,
  createdAt: string,
  overrides: Partial<Parameters<typeof TaskEntity.create>[0]> = {},
): TaskEntity {
  return TaskEntity.create({
    id: TaskIdSchema.parse(`20260508-${hex}`),
    agent: "a",
    brief: TaskBriefSchema.parse("b"),
    createdAt,
    ...overrides,
  });
}

describe("ListTasksUseCase", () => {
  it("returns tasks newest-first (createdAt desc, id desc tiebreak)", async () => {
    await seed(at("00000001", "2026-05-08T01:00:00.000Z"));
    await seed(at("00000002", "2026-05-08T02:00:00.000Z"));
    await seed(at("00000003", "2026-05-08T02:00:00.000Z"));

    const res = (await useCase.execute({}))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual([
      "20260508-00000003",
      "20260508-00000002",
      "20260508-00000001",
    ]);
  });

  it("forwards only the present filters to the repository", async () => {
    await seed(at("00000001", "2026-05-08T01:00:00.000Z", { agent: "x" }));
    await seed(at("00000002", "2026-05-08T01:00:00.000Z", { agent: "other" }));
    const terminal = at("00000003", "2026-05-08T01:00:00.000Z", { agent: "x" });
    terminal
      .complete({ output: "done", artifacts: [] }, { now: "2026-05-08T02:00:00.000Z" })
      ._unsafeUnwrap();
    await seed(terminal);

    const res = (await useCase.execute({ agent: "x", status: "running" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000001"]);
  });
});

describe("ListTasksUseCase — origin scoping", () => {
  // A workflow node's tasks carry `origin: "workflow"`, `originId: <nodeId>`.
  // The origin pair is the lookup key exposed by `glyph task list --origin`.
  async function seedNodeTrio(): Promise<void> {
    // Same node, three terminal-or-running statuses, ascending createdAt.
    await seed(
      at("00000010", "2026-05-08T01:00:00.000Z", { origin: "workflow", originId: "node-7" }),
    );

    const done = at("00000011", "2026-05-08T02:00:00.000Z", {
      origin: "workflow",
      originId: "node-7",
    });
    done
      .complete({ output: "ok", artifacts: [] }, { now: "2026-05-08T03:00:00.000Z" })
      ._unsafeUnwrap();
    await seed(done);

    const failed = at("00000012", "2026-05-08T03:00:00.000Z", {
      origin: "workflow",
      originId: "node-7",
    });
    failed
      .fail(
        { kind: "execution", exitCode: 1, message: "boom" },
        { now: "2026-05-08T04:00:00.000Z" },
      )
      ._unsafeUnwrap();
    await seed(failed);
  }

  it("returns every status for a node's origin pair, newest-first", async () => {
    await seedNodeTrio();
    // Noise that must be excluded: a standalone task and a different node.
    await seed(at("00000020", "2026-05-08T05:00:00.000Z"));
    await seed(
      at("00000021", "2026-05-08T05:00:00.000Z", { origin: "workflow", originId: "node-9" }),
    );

    const res = (await useCase.execute({ origin: "workflow", originId: "node-7" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual([
      "20260508-00000012",
      "20260508-00000011",
      "20260508-00000010",
    ]);
    expect(res.map((t) => t.status)).toEqual(["failed", "succeeded", "running"]);
  });

  it("composes the origin pair with a status filter", async () => {
    await seedNodeTrio();

    const res = (
      await useCase.execute({ origin: "workflow", originId: "node-7", status: "failed" })
    )._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000012"]);
  });

  it("returns [] for an origin pair with no tasks", async () => {
    await seedNodeTrio();

    const res = (
      await useCase.execute({ origin: "workflow", originId: "ghost-node" })
    )._unsafeUnwrap();

    expect(res).toEqual([]);
  });

  it("isolates by originId within the same origin kind (1:N retries)", async () => {
    // Two retries against node-7, one unrelated task against node-9.
    await seed(
      at("00000030", "2026-05-08T01:00:00.000Z", { origin: "workflow", originId: "node-7" }),
    );
    await seed(
      at("00000031", "2026-05-08T02:00:00.000Z", { origin: "workflow", originId: "node-7" }),
    );
    await seed(
      at("00000032", "2026-05-08T02:00:00.000Z", { origin: "workflow", originId: "node-9" }),
    );

    const res = (await useCase.execute({ origin: "workflow", originId: "node-7" }))._unsafeUnwrap();

    expect(res.map((t) => t.id)).toEqual(["20260508-00000031", "20260508-00000030"]);
  });

  it("scopes to its own db — an identical origin pair in another workspace is invisible", async () => {
    await seed(
      at("00000040", "2026-05-08T01:00:00.000Z", { origin: "workflow", originId: "node-7" }),
    );

    // A second, independent workspace db with a colliding origin pair.
    const other = openDb(":memory:");
    try {
      const otherRepo = new DrizzleTaskRepository({ db: other.db });
      const otherUseCase = new ListTasksUseCase({
        query: new DrizzleTaskQueries({ db: other.db }),
      });
      (
        await otherRepo.save(
          at("00000041", "2026-05-08T09:00:00.000Z", { origin: "workflow", originId: "node-7" }),
        )
      )._unsafeUnwrap();

      const here = (
        await useCase.execute({ origin: "workflow", originId: "node-7" })
      )._unsafeUnwrap();
      const there = (
        await otherUseCase.execute({ origin: "workflow", originId: "node-7" })
      )._unsafeUnwrap();

      expect(here.map((t) => t.id)).toEqual(["20260508-00000040"]);
      expect(there.map((t) => t.id)).toEqual(["20260508-00000041"]);
    } finally {
      other.close();
    }
  });
});
