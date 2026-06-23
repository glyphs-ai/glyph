/**
 * `ListTaskOpts.metadataEquals` filters to tasks whose top-level
 * metadata key matches the given value. AND-composes with the other
 * filters — in particular with `origin`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskEntity } from "../src/task-entity.js";
import { TaskRepository } from "../src/task-repository.js";
import { openTestTaskDb } from "../src/testing.js";
import type { TaskOrigin } from "../src/types.js";

let orm: ReturnType<typeof openTestTaskDb>;
let repo: TaskRepository;

beforeEach(() => {
  orm = openTestTaskDb();
  repo = new TaskRepository({ db: orm.db });
});
afterEach(() => {
  orm.close();
});

async function seed(id: string, origin: TaskOrigin, refId: string | null): Promise<void> {
  await repo.save(
    TaskEntity.fromStored({
      id,
      agent: "demo",
      brief: "b",
      origin,
      status: "running",
      metadata: refId === null ? {} : { refId },
      createdAt: "2026-05-19T01:00:00.000Z",
      startedAt: "2026-05-19T01:00:00.000Z",
    }),
  );
}

describe("TaskRepository.list — metadataEquals filter", () => {
  beforeEach(async () => {
    await seed("20260519-aaaaaaaa", "workflow", "r1");
    await seed("20260519-bbbbbbbb", "workflow", "r2");
    await seed("20260519-cccccccc", "standalone", null);
  });

  it("metadataEquals filter selects only tasks with the matching metadata key/value", async () => {
    const matching = await repo.list({ metadataEquals: { key: "refId", value: "r1" } });
    expect(matching.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
  });

  it("metadataEquals combined with origin narrows the set (AND semantics)", async () => {
    const matching = await repo.list({
      metadataEquals: { key: "refId", value: "r1" },
      origin: "workflow",
    });
    expect(matching.map((t) => t.id)).toEqual(["20260519-aaaaaaaa"]);
  });

  it("metadataEquals combined with non-matching origin returns empty", async () => {
    const matching = await repo.list({
      metadataEquals: { key: "refId", value: "r1" },
      origin: "standalone",
    });
    expect(matching).toEqual([]);
  });

  it("metadataEquals with no matches returns empty", async () => {
    const matching = await repo.list({ metadataEquals: { key: "refId", value: "nonexistent" } });
    expect(matching).toEqual([]);
  });

  it("omitting metadataEquals returns rows of every origin (filter disabled)", async () => {
    const all = await repo.list();
    expect(all.map((t) => t.id).sort()).toEqual([
      "20260519-aaaaaaaa",
      "20260519-bbbbbbbb",
      "20260519-cccccccc",
    ]);
  });
});
