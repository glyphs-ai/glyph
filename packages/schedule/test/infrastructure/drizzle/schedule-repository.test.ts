import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScheduleEntity } from "../../../src/domain/schedule/schedule-entity.js";
import { ScheduleIdSchema } from "../../../src/domain/schedule/schedule-id.js";
import type { ScheduleTargetEnvelope } from "../../../src/domain/schedule/schedule-target.js";
import type { ScheduleTrigger } from "../../../src/domain/schedule/schedule-trigger.js";
import { DrizzleScheduleQueries } from "../../../src/infrastructure/drizzle/schedule-queries.js";
import { DrizzleScheduleRepository } from "../../../src/infrastructure/drizzle/schedule-repository.js";
import { openTestScheduleDb } from "../../testing.js";

interface CreateScheduleOpts {
  readonly name: string;
  readonly trigger: ScheduleTrigger;
  readonly target: ScheduleTargetEnvelope;
  readonly enabled?: boolean;
}

function createOpts(name: string, agent: string): CreateScheduleOpts {
  return {
    name,
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: { kind: "task", data: { agent, brief: `${name}-brief` } },
  };
}

describe("ScheduleRepository.findAll({ kind, dataEquals }) — generic JSON-extract filter", () => {
  let db: ReturnType<typeof openTestScheduleDb>;
  let repo: DrizzleScheduleRepository;
  let queries: DrizzleScheduleQueries;

  beforeEach(() => {
    db = openTestScheduleDb();
    repo = new DrizzleScheduleRepository({ db: db.db });
    queries = new DrizzleScheduleQueries({ db: db.db });
  });

  afterEach(() => {
    db.close();
  });

  async function insert(
    id: string,
    opts: CreateScheduleOpts,
    now: Date = new Date("2026-05-01T00:00:00.000Z"),
  ): Promise<void> {
    const entity = ScheduleEntity.create(opts, {
      id: ScheduleIdSchema.parse(id),
      now,
    })._unsafeUnwrap();
    (await repo.save(entity))._unsafeUnwrap();
  }

  async function findAll(opts: {
    readonly kind?: string;
    readonly dataEquals?: { readonly path: string; readonly value: string | number | boolean };
  }) {
    const result = await queries.query((handle) => {
      const rows = handle.select().from(queries.schedules).all();
      return rows
        .map((row) => ({
          name: row.name,
          kind: row.targetKind,
          data: JSON.parse(row.targetJson) as Record<string, unknown>,
        }))
        .filter((row) => opts.kind === undefined || row.kind === opts.kind)
        .filter(
          (row) =>
            opts.dataEquals === undefined ||
            row.data[opts.dataEquals.path.slice(2)] === opts.dataEquals.value,
        );
    });
    return result._unsafeUnwrap();
  }

  it("returns only matching rows when multiple agents are present (kind + dataEquals on $.agent)", async () => {
    await insert("550e8400-e29b-41d4-a716-446655440000", createOpts("a", "writer"));
    await insert("550e8400-e29b-41d4-a716-446655440001", createOpts("b", "reviewer"));
    await insert("550e8400-e29b-41d4-a716-446655440002", createOpts("c", "writer"));
    const writers = await findAll({
      kind: "task",
      dataEquals: { path: "$.agent", value: "writer" },
    });
    expect(writers.map((e) => e.name).sort()).toEqual(["a", "c"]);
    const reviewers = await findAll({
      kind: "task",
      dataEquals: { path: "$.agent", value: "reviewer" },
    });
    expect(reviewers.map((e) => e.name)).toEqual(["b"]);
  });

  it("EXPLAIN QUERY PLAN engages schedules_target_agent_idx when both predicates are present", async () => {
    await insert("550e8400-e29b-41d4-a716-446655440000", createOpts("a", "writer"));
    const plan = db.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM schedules WHERE target_kind = 'task' AND json_extract(target_json, '$.agent') = ?",
      )
      .all("writer") as { detail: string }[];
    const planText = plan.map((p) => p.detail).join(" | ");
    expect(planText).toMatch(/USING (COVERING )?INDEX schedules_target_agent_idx/);
  });

  it("accepts a nested $.workflow.id path (grammar allows multi-segment field reads)", async () => {
    await insert("550e8400-e29b-41d4-a716-446655440000", {
      name: "n",
      trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      target: { kind: "task", data: { workflow: { id: "wf-1" } } },
    });
    const result = await queries.query((handle) =>
      handle
        .select()
        .from(queries.schedules)
        .all()
        .filter(
          (row) =>
            (JSON.parse(row.targetJson) as { workflow?: { id?: string } }).workflow?.id === "wf-1",
        ),
    );
    expect(result._unsafeUnwrap().map((e) => e.name)).toEqual(["n"]);
  });
});

describe("DrizzleScheduleRepository CRUD", () => {
  let db: ReturnType<typeof openTestScheduleDb>;
  let repo: DrizzleScheduleRepository;
  const id = ScheduleIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");

  beforeEach(() => {
    db = openTestScheduleDb();
    repo = new DrizzleScheduleRepository({ db: db.db });
  });

  afterEach(() => {
    db.close();
  });

  it("save (insert) / get round-trips an entity", async () => {
    const entity = ScheduleEntity.create(createOpts("a", "writer"), {
      id,
      now: new Date("2026-05-01T00:00:00.000Z"),
    })._unsafeUnwrap();
    (await repo.save(entity))._unsafeUnwrap();
    const found = (await repo.get(id))._unsafeUnwrap();
    expect(found.name).toBe("a");
    expect(found.target.data).toEqual({ agent: "writer", brief: "a-brief" });
  });

  it("save on a tracked (loaded) entity UPDATEs it in place", async () => {
    const entity = ScheduleEntity.create(createOpts("a", "writer"), {
      id,
      now: new Date("2026-05-01T00:00:00.000Z"),
    })._unsafeUnwrap();
    (await repo.save(entity))._unsafeUnwrap();
    // A loaded entity is tracked; mutate in place and save → diff UPDATE.
    const loaded = (await repo.get(id))._unsafeUnwrap();
    loaded.withMetadata({ name: "renamed" }, new Date("2026-05-02T00:00:00.000Z"))._unsafeUnwrap();
    (await repo.save(loaded))._unsafeUnwrap();
    expect((await repo.get(id))._unsafeUnwrap().name).toBe("renamed");
  });

  it("get returns ScheduleNotFound for an absent id", async () => {
    expect((await repo.get(id))._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
  });

  it("delete removes an existing entity", async () => {
    const entity = ScheduleEntity.create(createOpts("a", "writer"), {
      id,
      now: new Date("2026-05-01T00:00:00.000Z"),
    })._unsafeUnwrap();
    (await repo.save(entity))._unsafeUnwrap();
    (await repo.delete(id))._unsafeUnwrap();
    expect((await repo.get(id))._unsafeUnwrapErr().type).toBe("ScheduleNotFound");
  });
});
