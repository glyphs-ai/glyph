import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflows } from "../../src/infrastructure/drizzle/workflow-schema.js";
import { buildWorkflowFixture, type WorkflowFixture } from "./workflow-fixture.js";

let f: WorkflowFixture;

beforeEach(async () => {
  f = await buildWorkflowFixture();
});
afterEach(async () => {
  await f.close();
});

async function insertWorkflow(args: {
  id: string;
  origin: string;
  originId: string | null;
  status: string;
}): Promise<void> {
  await f.db
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
    const result = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: [],
      })
    )._unsafeUnwrap();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("counts totalCount and runningCount keyed by originId", async () => {
    await insertWorkflow({
      id: "20260607-00000001",
      origin: "fake-origin-x",
      originId: "r1",
      status: "running",
    });
    await insertWorkflow({
      id: "20260607-00000002",
      origin: "fake-origin-x",
      originId: "r1",
      status: "running",
    });
    await insertWorkflow({
      id: "20260607-00000003",
      origin: "fake-origin-x",
      originId: "r2",
      status: "running",
    });

    const result = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: ["r1", "r2"],
      })
    )._unsafeUnwrap();

    expect(result.r1).toEqual({ totalCount: 2, runningCount: 2, awaitingCount: 0 });
    expect(result.r2).toEqual({ totalCount: 1, runningCount: 1, awaitingCount: 0 });
  });

  it("respects statusIn filter", async () => {
    await insertWorkflow({
      id: "20260607-00000001",
      origin: "fake-origin-x",
      originId: "r1",
      status: "running",
    });
    await insertWorkflow({
      id: "20260607-00000002",
      origin: "fake-origin-x",
      originId: "r1",
      status: "succeeded",
    });

    const allStatuses = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: ["r1"],
      })
    )._unsafeUnwrap();
    expect(allStatuses.r1?.totalCount).toBe(2);

    const onlyRunning = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: ["r1"],
        statusIn: ["running"],
      })
    )._unsafeUnwrap();
    expect(onlyRunning.r1?.totalCount).toBe(1);
    expect(onlyRunning.r1?.runningCount).toBe(1);
  });

  it("does not match workflows from a different origin", async () => {
    await insertWorkflow({
      id: "20260607-00000001",
      origin: "fake-origin-x",
      originId: "r1",
      status: "running",
    });
    await insertWorkflow({
      id: "20260607-00000002",
      origin: "standalone",
      originId: "r1",
      status: "running",
    });

    const result = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: ["r1"],
      })
    )._unsafeUnwrap();
    expect(result.r1?.totalCount).toBe(1);
  });

  it("originIds not present yields absent keys in the map", async () => {
    const result = (
      await f.module.aggregateByOrigin.execute({
        origin: "fake-origin-x",
        originIds: ["nonexistent"],
      })
    )._unsafeUnwrap();
    // NOTE: the Result-native aggregate returns explicit zero-count entries for
    // requested origin ids that have no matching workflows.
    expect(result.nonexistent).toEqual({ totalCount: 0, runningCount: 0, awaitingCount: 0 });
  });
});
