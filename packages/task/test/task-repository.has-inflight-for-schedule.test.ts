/**
 * `TaskRepository.hasInFlightByOrigin` is the origin-agnostic
 * concurrency guard that integration packages use (via typed wrappers)
 * to check whether a non-terminal task exists for a given `(origin,
 * origin_id)` pair.
 *
 * Predicate: `origin = ? AND origin_id = ? AND status NOT IN terminal`.
 * The origin guard discriminates: a standalone task carrying the same
 * origin_id does NOT match.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../src/task-entity.js";
import { TaskRepository } from "../src/task-repository.js";
import { openTestTaskDb } from "../src/testing.js";
import type {
  TaskCancellation,
  TaskFailure,
  TaskOrigin,
  TaskStatus,
  TaskSuccess,
} from "../src/types.js";

let orm: ReturnType<typeof openTestTaskDb>;
let repo: TaskRepository;

beforeEach(() => {
  orm = openTestTaskDb();
  repo = new TaskRepository({ db: orm.db });
});
afterEach(() => {
  orm.close();
});

async function seed(args: {
  id: string;
  origin: TaskOrigin;
  status: TaskStatus;
  originId?: string;
  success?: TaskSuccess;
  failure?: TaskFailure;
  cancellation?: TaskCancellation;
}): Promise<void> {
  await repo.save(
    TaskEntity.fromStored({
      id: args.id,
      agent: "demo",
      brief: "b",
      origin: args.origin,
      ...(args.originId !== undefined ? { originId: args.originId } : {}),
      status: args.status,
      metadata: {},
      createdAt: "2026-05-19T01:00:00.000Z",
      startedAt: "2026-05-19T01:00:00.000Z",
      ...(args.status !== "running" ? { endedAt: "2026-05-19T02:00:00.000Z" } : {}),
      ...(args.success !== undefined ? { success: args.success } : {}),
      ...(args.failure !== undefined ? { failure: args.failure } : {}),
      ...(args.cancellation !== undefined ? { cancellation: args.cancellation } : {}),
    }),
  );
}

const OPTS = { origin: "workflow", originId: "r1" } as const;

describe("TaskRepository.hasInFlightByOrigin", () => {
  it("(a) returns false when no tasks exist", async () => {
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(false);
  });

  it("(b) returns true for a running task with matching origin and origin_id", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "running",
      originId: "r1",
    });
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(true);
  });

  it("(c) returns false when all matching tasks are terminal", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      originId: "r1",
      success: { output: "ok" },
    });
    await seed({
      id: "20260519-bbbbbbbb",
      origin: "workflow",
      status: "failed",
      originId: "r1",
      failure: { kind: "internal", message: "boom" },
    });
    await seed({
      id: "20260519-cccccccc",
      origin: "workflow",
      status: "cancelled",
      originId: "r1",
      cancellation: { kind: "user", message: "stop" },
    });
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(false);
  });

  it("(d) returns false when only DIFFERENT origin_id values have running tasks", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "running",
      originId: "r2",
    });
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(false);
  });

  it("(e) returns false when a different-origin task carries matching origin_id (origin guard discriminates)", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "standalone",
      status: "running",
      originId: "r1",
    });
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(false);
  });

  it("mixed: returns true if at least one running task matches", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      originId: "r1",
      success: { output: "old" },
    });
    await seed({
      id: "20260519-bbbbbbbb",
      origin: "workflow",
      status: "running",
      originId: "r1",
    });
    expect(await repo.hasInFlightByOrigin(OPTS)).toBe(true);
  });
});
