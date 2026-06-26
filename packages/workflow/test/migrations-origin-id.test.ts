/**
 * Migration fixture test for the typed `(origin, origin_id)` substrate on
 * the `workflows` table. Mirrors the task package's fixture test, but the
 * workflows backfill is **single-branch** — only `origin='schedule'`
 * carries a routing id (`$.scheduleId`); workflow-origin tasks live in the
 * task table, not here.
 *
 * Pins, on a real in-memory SQLite instance:
 *
 *   1. **Post-state** — composite partial index `workflows_origin_pair_idx`
 *      exists; the legacy `workflows_schedule_id_idx` is dropped.
 *   2. **Backfill (pre → post)** — a legacy schedule-origin row carrying
 *      `metadata.scheduleId` migrates to the typed `origin_id` column;
 *      standalone rows stay NULL.
 *   3. **Defensive assertion** — a schedule-origin row the backfill cannot
 *      populate aborts the migration via its `RAISE(FAIL)` guard.
 *
 * Idempotency: a second `applyWorkflowMigrations` is journal-gated to a
 * no-op.
 */

import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyWorkflowMigrations, MIGRATIONS } from "../src/migrations.js";
import { openTestWorkflowDb } from "../src/testing.js";

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

/** Insert a legacy (pre-origin_id) workflow row carrying its id in metadata. */
function insertLegacyWorkflow(
  sqlite: BetterSqliteDatabase,
  row: { id: string; origin: string; metadata: Record<string, unknown> },
): void {
  sqlite
    .prepare(
      "INSERT INTO `workflows` (`id`, `brief`, `coordinator_agent`, `created_at`, `metadata`, `status`, `origin`) " +
        "VALUES (?, 'b', 'official/engineer', '2026-01-01T00:00:00.000Z', ?, 'running', ?)",
    )
    .run(row.id, JSON.stringify(row.metadata), row.origin);
}

describe("workflows origin_id migration: post-state", () => {
  it("creates the (origin, origin_id) composite partial index and drops the legacy schedule-id index", () => {
    const orm = openTestWorkflowDb();
    try {
      const indexes = orm.sqlite.prepare("PRAGMA index_list('workflows')").all() as Array<{
        name: string;
        partial: number;
      }>;
      const pair = indexes.find((r) => r.name === "workflows_origin_pair_idx");
      expect(pair, "workflows_origin_pair_idx must exist post-migration").toBeDefined();
      expect(pair?.partial, "it is a partial index (WHERE origin_id IS NOT NULL)").toBe(1);

      const cols = (
        orm.sqlite.prepare("PRAGMA index_info('workflows_origin_pair_idx')").all() as Array<{
          name: string | null;
        }>
      ).map((r) => r.name);
      expect(cols).toEqual(["origin", "origin_id"]);

      const legacy = indexes.find((r) => r.name === "workflows_schedule_id_idx");
      expect(legacy, "workflows_schedule_id_idx must be dropped").toBeUndefined();
    } finally {
      orm.close();
    }
  });
});

describe("workflows origin_id migration: backfill (pre → post)", () => {
  it("backfills scheduleId onto origin_id for schedule-origin rows; standalone stays NULL", () => {
    const sqlite = new Database(":memory:");
    try {
      applyThrough(sqlite, ORIGIN_ID_MIGRATION_INDEX);

      insertLegacyWorkflow(sqlite, {
        id: "wf-sched",
        origin: "schedule",
        metadata: { scheduleId: "sched-7" },
      });
      insertLegacyWorkflow(sqlite, { id: "wf-std", origin: "standalone", metadata: {} });

      applyMigration(sqlite, ORIGIN_ID_MIGRATION_INDEX);

      const rows = sqlite
        .prepare("SELECT id, origin_id FROM `workflows` ORDER BY id ASC")
        .all() as Array<{ id: string; origin_id: string | null }>;
      const byId = new Map(rows.map((r) => [r.id, r.origin_id]));
      expect(byId.get("wf-sched")).toBe("sched-7");
      expect(byId.get("wf-std")).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("aborts when a schedule-origin row cannot be backfilled (RAISE(FAIL) guard)", () => {
    const sqlite = new Database(":memory:");
    try {
      applyThrough(sqlite, ORIGIN_ID_MIGRATION_INDEX);
      insertLegacyWorkflow(sqlite, { id: "wf-broken", origin: "schedule", metadata: {} });

      expect(() => applyMigration(sqlite, ORIGIN_ID_MIGRATION_INDEX)).toThrow(
        /backfill incomplete/,
      );
    } finally {
      sqlite.close();
    }
  });
});

describe("workflows origin_id migration: idempotent rerun", () => {
  it("a second applyWorkflowMigrations is a no-op (journal-gated), not a double-apply error", () => {
    const orm = openTestWorkflowDb();
    try {
      const before = orm.sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations_workflow")
        .get() as { n: number };
      expect(() => {
        applyWorkflowMigrations(orm.db);
      }).not.toThrow();
      const after = orm.sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations_workflow")
        .get() as { n: number };
      expect(after.n).toBe(before.n);
    } finally {
      orm.close();
    }
  });
});
