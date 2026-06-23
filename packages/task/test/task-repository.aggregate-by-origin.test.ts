import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../src/task-entity.js";
import { TaskRepository } from "../src/task-repository.js";
import { openTestTaskDb } from "../src/testing.js";
import type { TaskOrigin, TaskStatus } from "../src/types.js";

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
      ...(args.status === "succeeded" ? { success: { output: "ok" } } : {}),
      ...(args.status === "failed" ? { failure: { kind: "internal", message: "x" } } : {}),
    }),
  );
}

describe("TaskRepository.aggregateByOriginMetadataKey", () => {
  it("returns empty map when metadataValues is empty", async () => {
    const result = await repo.aggregateByOriginMetadataKey({
      origin: "workflow",
      metadataKey: "refId",
      metadataValues: [],
    });
    expect(result.size).toBe(0);
  });

  it("counts totalCount and runningCount for matching tasks", async () => {
    await seed({ id: "20260519-aaaaaaaa", origin: "workflow", status: "running", refId: "r1" });
    await seed({ id: "20260519-bbbbbbbb", origin: "workflow", status: "succeeded", refId: "r1" });
    await seed({ id: "20260519-cccccccc", origin: "workflow", status: "running", refId: "r2" });

    const result = await repo.aggregateByOriginMetadataKey({
      origin: "workflow",
      metadataKey: "refId",
      metadataValues: ["r1", "r2"],
    });

    expect(result.get("r1")).toEqual({ totalCount: 2, runningCount: 1 });
    expect(result.get("r2")).toEqual({ totalCount: 1, runningCount: 1 });
  });

  it("respects statusIn filter", async () => {
    await seed({ id: "20260519-aaaaaaaa", origin: "workflow", status: "running", refId: "r1" });
    await seed({ id: "20260519-bbbbbbbb", origin: "workflow", status: "succeeded", refId: "r1" });

    const onlyRunning = await repo.aggregateByOriginMetadataKey({
      origin: "workflow",
      metadataKey: "refId",
      metadataValues: ["r1"],
      statusIn: ["running"],
    });
    expect(onlyRunning.get("r1")).toEqual({ totalCount: 1, runningCount: 1 });
  });

  it("does not match tasks from a different origin", async () => {
    await seed({ id: "20260519-aaaaaaaa", origin: "workflow", status: "running", refId: "r1" });
    await seed({ id: "20260519-bbbbbbbb", origin: "standalone", status: "running", refId: "r1" });

    const result = await repo.aggregateByOriginMetadataKey({
      origin: "workflow",
      metadataKey: "refId",
      metadataValues: ["r1"],
    });
    expect(result.get("r1")!.totalCount).toBe(1);
  });

  it("metadataValues not present yields absent keys in the map", async () => {
    const result = await repo.aggregateByOriginMetadataKey({
      origin: "workflow",
      metadataKey: "refId",
      metadataValues: ["nonexistent"],
    });
    expect(result.has("nonexistent")).toBe(false);
  });
});
