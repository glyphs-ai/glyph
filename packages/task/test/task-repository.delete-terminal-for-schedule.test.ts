/**
 * `TaskRepository.deleteTerminalByOrigin` is the SQL side of the
 * cascade-delete feature: when an integration removes its resource,
 * every TERMINAL task matching the typed `(origin, origin_id)` pair is
 * purged in a single statement so historical rows don't outlive the
 * trigger.
 *
 * In-flight (non-terminal) tasks are deliberately untouched — the
 * service layer guarantees there are none via the `hasInFlightByOrigin`
 * guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("TaskRepository.deleteTerminalByOrigin", () => {
  it("returns an empty array and is a no-op when no tasks match", async () => {
    expect(await repo.deleteTerminalByOrigin(OPTS)).toEqual([]);
  });

  it("removes every terminal status for matching (origin, origin_id)", async () => {
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
    const deleted = await repo.deleteTerminalByOrigin(OPTS);
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
      originId: "r1",
      success: { output: "ok" },
    });
    await seed({
      id: "20260519-bbbbbbbb",
      origin: "workflow",
      status: "running",
      originId: "r1",
    });
    const deleted = await repo.deleteTerminalByOrigin(OPTS);
    expect(deleted.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
    expect(await repo.read("20260519-bbbbbbbb")).not.toBeNull();
  });

  it("does NOT cross origin_id boundaries — only matching originId is removed", async () => {
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
      status: "succeeded",
      originId: "r2",
      success: { output: "ok" },
    });
    const deleted = await repo.deleteTerminalByOrigin(OPTS);
    expect(deleted.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
    expect(await repo.read("20260519-bbbbbbbb")).not.toBeNull();
  });

  it("origin guard discriminates — different-origin tasks are NOT touched", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "standalone",
      status: "succeeded",
      originId: "r1",
      success: { output: "ok" },
    });
    const deleted = await repo.deleteTerminalByOrigin(OPTS);
    expect(deleted).toEqual([]);
    expect(await repo.read("20260519-aaaaaaaa")).not.toBeNull();
  });

  it("is idempotent — running it twice after the first sweep is a no-op", async () => {
    await seed({
      id: "20260519-aaaaaaaa",
      origin: "workflow",
      status: "succeeded",
      originId: "r1",
      success: { output: "ok" },
    });
    await repo.deleteTerminalByOrigin(OPTS);
    expect(await repo.deleteTerminalByOrigin(OPTS)).toEqual([]);
  });
});

/**
 * Criterion 11 / closes #91: the cost of cleaning up a schedule on
 * `DELETE /schedules/:sid` must NOT scale with how many times the
 * schedule has fired. The cleanup delegates to this primitive, whose
 * DELETE is predicate-based (`origin`, `origin_id`, terminal `status`)
 * rather than an `IN (id, id, …)` list — so a schedule that fired 40
 * times is purged with the same fixed number of SQL round-trips as one
 * that fired once. We pin that by spying on the connection's
 * `prepare` and asserting the statement count is independent of N.
 */
async function measureScheduleDelete(
  fireCount: number,
): Promise<{ prepares: number; deletedCount: number }> {
  const localOrm = openTestTaskDb();
  try {
    const localRepo = new TaskRepository({ db: localOrm.db });
    for (let i = 0; i < fireCount; i++) {
      await localRepo.save(
        TaskEntity.fromStored({
          id: `20260519-${i.toString(16).padStart(8, "0")}`,
          agent: "demo",
          brief: "b",
          origin: "schedule",
          originId: "sched-1",
          status: "succeeded",
          metadata: {},
          createdAt: "2026-05-19T01:00:00.000Z",
          startedAt: "2026-05-19T01:00:00.000Z",
          endedAt: "2026-05-19T02:00:00.000Z",
          success: { output: "ok" },
        }),
      );
    }
    const spy = vi.spyOn(localOrm.sqlite, "prepare");
    const deleted = await localRepo.deleteTerminalByOrigin({
      origin: "schedule",
      originId: "sched-1",
    });
    const prepares = spy.mock.calls.length;
    spy.mockRestore();
    return { prepares, deletedCount: deleted.length };
  } finally {
    localOrm.close();
  }
}

describe("TaskRepository.deleteTerminalByOrigin — round-trip count is fire-count independent", () => {
  it("issues a fixed number of SQL statements whether the schedule fired once or many times", async () => {
    const once = await measureScheduleDelete(1);
    const many = await measureScheduleDelete(40);

    // Both purges are complete — the single predicate-DELETE handles all N.
    expect(once.deletedCount).toBe(1);
    expect(many.deletedCount).toBe(40);

    // The whole point of the typed-column refactor: cleanup cost is O(1)
    // round-trips, not O(fires). 40× the history, same statement count.
    expect(many.prepares).toBe(once.prepares);
  });
});
