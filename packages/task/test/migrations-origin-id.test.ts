/**
 * Migration fixture test for the typed `(origin, origin_id)` substrate.
 *
 * Three things are pinned here, all on a real in-memory SQLite instance
 * (not a source-text scan):
 *
 *   1. **Post-state** — a freshly-migrated DB exposes the composite
 *      partial index `tasks_origin_pair_idx` and has dropped the legacy
 *      `tasks_schedule_id_idx`.
 *   2. **Backfill (pre → post)** — legacy rows carrying the routing id in
 *      `metadata` migrate to the typed `origin_id` column. The tasks
 *      backfill is **two-branch**: `origin='schedule'` reads
 *      `$.scheduleId`; `origin='workflow'` reads `$.workflowNodeId`. A
 *      one-branch backfill would silently leave every workflow-origin row
 *      with NULL `origin_id`.
 *   3. **Defensive assertion** — a non-standalone row the backfill cannot
 *      populate aborts the migration via its `RAISE(FAIL)` guard.
 *
 * Idempotency is covered too: drizzle's journal makes a second
 * `applyTaskMigrations` a no-op rather than a double-apply error.
 */

import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyTaskMigrations, MIGRATIONS } from "../src/migrations.js";
import { openTestTaskDb } from "../src/testing.js";

/** The origin_id migration is the last inlined entry. */
const ORIGIN_ID_MIGRATION_INDEX = MIGRATIONS.length - 1;

/** Exec one inlined migration's statements against a raw connection. */
function applyMigration(sqlite: BetterSqliteDatabase, index: number): void {
  const m = MIGRATIONS[index];
  if (m === undefined) throw new Error(`no migration at index ${index}`);
  for (const stmt of m.sql) {
    const trimmed = stmt.trim();
    if (trimmed.length > 0) sqlite.exec(trimmed);
  }
}

/** Apply migrations `[0, uptoExclusive)` — i.e. the pre-origin_id schema. */
function applyThrough(sqlite: BetterSqliteDatabase, uptoExclusive: number): void {
  for (let i = 0; i < uptoExclusive; i++) applyMigration(sqlite, i);
}

/** Insert a legacy (pre-origin_id) task row carrying its id in metadata. */
function insertLegacyTask(
  sqlite: BetterSqliteDatabase,
  row: { id: string; origin: string; metadata: Record<string, unknown> },
): void {
  sqlite
    .prepare(
      "INSERT INTO `tasks` (`id`, `agent`, `status`, `brief`, `origin`, `created_at`, `started_at`, `metadata`) " +
        "VALUES (?, 'official/engineer', 'running', 'b', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)",
    )
    .run(row.id, row.origin, JSON.stringify(row.metadata));
}

describe("tasks origin_id migration: post-state", () => {
  it("creates the (origin, origin_id) composite partial index and drops the legacy schedule-id index", () => {
    const orm = openTestTaskDb();
    try {
      const indexes = orm.sqlite.prepare("PRAGMA index_list('tasks')").all() as Array<{
        name: string;
        partial: number;
      }>;
      const pair = indexes.find((r) => r.name === "tasks_origin_pair_idx");
      expect(pair, "tasks_origin_pair_idx must exist post-migration").toBeDefined();
      expect(pair?.partial, "it is a partial index (WHERE origin_id IS NOT NULL)").toBe(1);

      const cols = (
        orm.sqlite.prepare("PRAGMA index_info('tasks_origin_pair_idx')").all() as Array<{
          name: string | null;
        }>
      ).map((r) => r.name);
      expect(cols).toEqual(["origin", "origin_id"]);

      const legacy = indexes.find((r) => r.name === "tasks_schedule_id_idx");
      expect(legacy, "tasks_schedule_id_idx must be dropped").toBeUndefined();
    } finally {
      orm.close();
    }
  });

  it("the migration journal records one row per inlined migration, in order", () => {
    const orm = openTestTaskDb();
    try {
      const journal = orm.sqlite
        .prepare("SELECT id, hash FROM __drizzle_migrations_task ORDER BY id ASC")
        .all() as Array<{ id: number; hash: string }>;
      expect(journal.length).toBe(MIGRATIONS.length);
      for (const entry of journal) {
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      orm.close();
    }
  });
});

describe("tasks origin_id migration: backfill (pre → post)", () => {
  it("two-branch backfill maps scheduleId AND workflowNodeId onto origin_id; standalone stays NULL", () => {
    const sqlite = new Database(":memory:");
    try {
      applyThrough(sqlite, ORIGIN_ID_MIGRATION_INDEX);

      insertLegacyTask(sqlite, {
        id: "t-sched",
        origin: "schedule",
        metadata: { scheduleId: "sched-1", firedAt: "2026-01-01T00:00:00.000Z" },
      });
      insertLegacyTask(sqlite, {
        id: "t-wf",
        origin: "workflow",
        metadata: { workflowNodeId: "node-9", workflowId: "wf-1" },
      });
      insertLegacyTask(sqlite, { id: "t-std", origin: "standalone", metadata: {} });

      applyMigration(sqlite, ORIGIN_ID_MIGRATION_INDEX);

      const rows = sqlite
        .prepare("SELECT id, origin_id FROM `tasks` ORDER BY id ASC")
        .all() as Array<{ id: string; origin_id: string | null }>;
      const byId = new Map(rows.map((r) => [r.id, r.origin_id]));
      expect(byId.get("t-sched")).toBe("sched-1");
      expect(byId.get("t-wf")).toBe("node-9");
      expect(byId.get("t-std")).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("aborts when a non-standalone row cannot be backfilled (RAISE(FAIL) guard)", () => {
    const sqlite = new Database(":memory:");
    try {
      applyThrough(sqlite, ORIGIN_ID_MIGRATION_INDEX);
      // A workflow-origin row with no `workflowNodeId` — the backfill
      // leaves origin_id NULL, which the defensive assertion rejects.
      insertLegacyTask(sqlite, { id: "t-broken", origin: "workflow", metadata: {} });

      expect(() => applyMigration(sqlite, ORIGIN_ID_MIGRATION_INDEX)).toThrow(
        /backfill incomplete/,
      );
    } finally {
      sqlite.close();
    }
  });
});

describe("tasks origin_id migration: idempotent rerun", () => {
  it("a second applyTaskMigrations is a no-op (journal-gated), not a double-apply error", () => {
    const orm = openTestTaskDb();
    try {
      const before = orm.sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations_task")
        .get() as { n: number };
      // openTestTaskDb already applied once; applying again must not throw
      // (e.g. "duplicate column name: origin_id") and must not add rows.
      expect(() => {
        applyTaskMigrations(orm.db);
      }).not.toThrow();
      const after = orm.sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations_task")
        .get() as { n: number };
      expect(after.n).toBe(before.n);
    } finally {
      orm.close();
    }
  });
});
