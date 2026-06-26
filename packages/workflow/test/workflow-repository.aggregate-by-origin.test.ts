import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflows } from "../src/schema.js";
import { openTestWorkflowDb } from "../src/testing.js";
import { WorkflowRepository } from "../src/workflow-repository.js";

let testDb: ReturnType<typeof openTestWorkflowDb>;
let repo: WorkflowRepository;

beforeEach(() => {
  testDb = openTestWorkflowDb();
  repo = new WorkflowRepository({ db: testDb.db });
});
afterEach(() => {
  testDb.close();
});

function insertWorkflow(args: {
  id: string;
  origin: string;
  originId: string | null;
  status: string;
}): void {
  testDb.db
    .insert(workflows)
    .values({
      id: args.id,
      brief: "test",
      coordinatorAgent: "agent-a",
      status: args.status,
      origin: args.origin,
      originId: args.originId,
      metadata: "{}",
      createdAt: "2026-06-07T00:00:00.000Z",
      startedAt: "2026-06-07T00:00:00.000Z",
    })
    .run();
}

describe("WorkflowRepository.aggregateByOrigin", () => {
  it("returns empty map when originIds is empty", async () => {
    const result = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: [],
    });
    expect(result.size).toBe(0);
  });

  it("counts totalCount and runningCount keyed by originId", async () => {
    insertWorkflow({ id: "wf-001", origin: "fake-origin-x", originId: "r1", status: "running" });
    insertWorkflow({ id: "wf-002", origin: "fake-origin-x", originId: "r1", status: "running" });
    insertWorkflow({ id: "wf-003", origin: "fake-origin-x", originId: "r2", status: "running" });

    const result = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: ["r1", "r2"],
    });

    expect(result.get("r1")).toEqual({ totalCount: 2, runningCount: 2, awaitingCount: 0 });
    expect(result.get("r2")).toEqual({ totalCount: 1, runningCount: 1, awaitingCount: 0 });
  });

  it("respects statusIn filter", async () => {
    insertWorkflow({ id: "wf-001", origin: "fake-origin-x", originId: "r1", status: "running" });
    insertWorkflow({ id: "wf-002", origin: "fake-origin-x", originId: "r1", status: "succeeded" });

    const allStatuses = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: ["r1"],
    });
    expect(allStatuses.get("r1")!.totalCount).toBe(2);

    const onlyRunning = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: ["r1"],
      statusIn: ["running"],
    });
    expect(onlyRunning.get("r1")!.totalCount).toBe(1);
    expect(onlyRunning.get("r1")!.runningCount).toBe(1);
  });

  it("does not match workflows from a different origin", async () => {
    insertWorkflow({ id: "wf-001", origin: "fake-origin-x", originId: "r1", status: "running" });
    insertWorkflow({ id: "wf-002", origin: "standalone", originId: "r1", status: "running" });

    const result = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: ["r1"],
    });
    expect(result.get("r1")!.totalCount).toBe(1);
  });

  it("originIds not present yields absent keys in the map", async () => {
    const result = await repo.aggregateByOrigin({
      origin: "fake-origin-x",
      originIds: ["nonexistent"],
    });
    expect(result.has("nonexistent")).toBe(false);
  });
});
