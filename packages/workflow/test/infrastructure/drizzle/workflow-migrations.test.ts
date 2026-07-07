import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/infrastructure/drizzle/workflow-db.js";
import {
  applyWorkflowMigrations,
  MIGRATIONS,
} from "../../../src/infrastructure/drizzle/workflow-migrations.js";

/** Open a migrated workflow DB on a tmp file, exposing a raw read connection. */
function openMigratedFileDb(): {
  db: ReturnType<typeof openDb>["db"];
  sqlite: BetterSqliteDatabase;
  close(): void;
} {
  const dir = mkdtempSync(join(tmpdir(), "wf-mig-"));
  const dbFile = join(dir, "workspace.db");
  const { db, close } = openDb(dbFile);
  const sqlite = new Database(dbFile);
  return {
    db,
    sqlite,
    close() {
      sqlite.close();
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Drift guard mirroring `packages/_template`. If `pnpm db:generate` produces a
 * new `*.sql` in `drizzle/`, you must regenerate the inlined migrations via
 * `scripts/inline-migrations.mjs`.
 */
describe("workflows migrations-inventory", () => {
  const onDiskCount = readdirSync(join(import.meta.dirname, "..", "..", "..", "drizzle")).filter(
    (f) => f.endsWith(".sql"),
  ).length;

  it("MIGRATIONS has one entry per drizzle/*.sql file", () => {
    expect(MIGRATIONS.length).toBe(onDiskCount);
  });

  it("every migration has at least one non-empty SQL statement + a hash", () => {
    for (const m of MIGRATIONS) {
      expect(Array.isArray(m.sql)).toBe(true);
      expect(m.sql.length).toBeGreaterThan(0);
      expect(m.sql.some((stmt) => stmt.trim().length > 0)).toBe(true);
      expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("folderMillis is strictly monotonically increasing", () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const prev = MIGRATIONS[i - 1];
      const curr = MIGRATIONS[i];
      if (prev && curr) {
        expect(curr.folderMillis).toBeGreaterThan(prev.folderMillis);
      }
    }
  });
});

/**
 * Migration fixture test for the typed `(origin, origin_id)` substrate on the
 * `workflows` table. Mirrors the task package's fixture test, but the workflows
 * backfill is **single-branch** — only `origin='schedule'` carries a routing id
 * (`$.scheduleId`); workflow-origin tasks live in the task table, not here.
 */

/** The origin_id migration, located by its column-add so later appended migrations don't shift this index. */
const ORIGIN_ID_MIGRATION_INDEX = MIGRATIONS.findIndex((m) =>
  m.sql.some((stmt) => stmt.includes("ADD COLUMN `origin_id`")),
);

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
    const orm = openMigratedFileDb();
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
    const orm = openMigratedFileDb();
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
