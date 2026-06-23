/**
 * `TaskRepository.deleteTerminalByOriginMetadata` is the SQL side of
 * the cascade-delete feature: when an integration removes its resource,
 * every TERMINAL task matching `origin + metadata key/value` is purged
 * in a single statement so historical rows don't outlive the trigger.
 *
 * In-flight (non-terminal) tasks are deliberately untouched — the
 * service layer guarantees there are none via the
 * `hasInFlightByOriginMetadata` guard.
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

describe("TaskRepository.deleteTerminalByOriginMetadata", () => {
  it("returns an empty array and is a no-op when no tasks match", async () => {
    expect(await repo.deleteTerminalByOriginMetadata(OPTS)).toEqual([]);
  });

  it("removes every terminal status for matching origin+metadata", async () => {
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
    const deleted = await repo.deleteTerminalByOriginMetadata(OPTS);
    expect(deleted.map((t) => t.id).sort()).toEqual([
      "20260519-aaaaaaaa",
      "20260519-bbbbbbbb",
      "20260519-cccccccc",
    ]);
    expect(await repo.read("20260519-aaaaaaaa")).toBeNull();
    expect(await repo.read("20260519-bbbbbbbb")).toBeNull();
    expect(await repo.read("20260519-cccccccc")).toBeNull();
  });

  it("NEVER touches in-flight tasks — running rows are preserved", async () => {
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
      status: "running",
      refId: "r1",
    });
    const deleted = await repo.deleteTerminalByOriginMetadata(OPTS);
    expect(deleted.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
    expect(await repo.read("20260519-bbbbbbbb")).not.toBeNull();
  });

  it("does NOT cross metadata boundaries — only matching metadataValue is removed", async () => {
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
      status: "succeeded",
      refId: "r2",
      success: { output: "ok" },
    });
    const deleted = await repo.deleteTerminalByOriginMetadata(OPTS);
    expect(deleted.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
    expect(await repo.read("20260519-bbbbbbbb")).not.toBeNull();
  });

  it("origin guard discriminates — different-origin tasks are NOT touched", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "standalone",
      status: "succeeded",
      refId: "r1",
      success: { output: "ok" },
    });
    const deleted = await repo.deleteTerminalByOriginMetadata(OPTS);
    expect(deleted).toEqual([]);
    expect(await repo.read("20260519-aaaaaaaa")).not.toBeNull();
  });

  it("is idempotent — running it twice after the first sweep is a no-op", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      refId: "r1",
      success: { output: "ok" },
    });
    await repo.deleteTerminalByOriginMetadata(OPTS);
    expect(await repo.deleteTerminalByOriginMetadata(OPTS)).toEqual([]);
  });
});
