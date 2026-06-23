/**
 * `TaskRepository.hasInFlightByOriginMetadata` is the origin-agnostic
 * concurrency guard that integration packages use (via typed wrappers)
 * to check whether a non-terminal task exists for a given origin and
 * metadata key/value pair.
 *
 * Predicate: `origin = ? AND status NOT IN terminal AND
 * json_extract(metadata, '$.key') = ?`. The origin guard discriminates:
 * a standalone task carrying the same metadata key does NOT match.
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
  refId?: string;
  success?: TaskSuccess;
  failure?: TaskFailure;
  cancellation?: TaskCancellation;
}): Promise<void> {
  const metadata: Record<string, unknown> = {};
  if (args.refId !== undefined) metadata.refId = args.refId;
  await repo.save(
    TaskEntity.fromStored({
      id: args.id,
      agent: "demo",
      brief: "b",
      origin: args.origin,
      status: args.status,
      metadata,
      createdAt: "2026-05-19T01:00:00.000Z",
      startedAt: "2026-05-19T01:00:00.000Z",
      ...(args.status !== "running" ? { endedAt: "2026-05-19T02:00:00.000Z" } : {}),
      ...(args.success !== undefined ? { success: args.success } : {}),
      ...(args.failure !== undefined ? { failure: args.failure } : {}),
      ...(args.cancellation !== undefined ? { cancellation: args.cancellation } : {}),
    }),
  );
}

const OPTS = { origin: "workflow", metadataKey: "refId", metadataValue: "r1" } as const;

describe("TaskRepository.hasInFlightByOriginMetadata", () => {
  it("(a) returns false when no tasks exist", async () => {
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(false);
  });

  it("(b) returns true for a running task with matching origin and metadata", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "running",
      refId: "r1",
    });
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(true);
  });

  it("(c) returns false when all matching tasks are terminal", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      refId: "r1",
      success: { output: "ok" },
    });
    await seed({
      id: "20260519-bbbbbbbb",
      origin: "workflow",
      status: "failed",
      refId: "r1",
      failure: { kind: "internal", message: "boom" },
    });
    await seed({
      id: "20260519-cccccccc",
      origin: "workflow",
      status: "cancelled",
      refId: "r1",
      cancellation: { kind: "user", message: "stop" },
    });
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(false);
  });

  it("(d) returns false when only DIFFERENT metadata values have running tasks", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "running",
      refId: "r2",
    });
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(false);
  });

  it("(e) returns false when a different-origin task carries matching metadata (origin guard discriminates)", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "standalone",
      status: "running",
      refId: "r1",
    });
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(false);
  });

  it("mixed: returns true if at least one running task matches", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      refId: "r1",
      success: { output: "old" },
    });
    await seed({
      id: "20260519-bbbbbbbb",
      origin: "workflow",
      status: "running",
      refId: "r1",
    });
    expect(await repo.hasInFlightByOriginMetadata(OPTS)).toBe(true);
  });
});
