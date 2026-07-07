import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/infrastructure/drizzle/workflow-db.js";
import {
  applyWorkflowMigrations,
  MIGRATIONS,
} from "../../../src/infrastructure/drizzle/workflow-migrations.js";

async function removeDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error;
    if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
  }
}

/** Open a migrated workflow DB on a tmp file, exposing a raw read connection. */
async function openMigratedFileDb(): Promise<{
  client: Client;
  close(): Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), "wf-mig-"));
  const dbFile = join(dir, "workspace.db");
  const { close } = await openDb(dbFile);
  close();
  const client = createClient({ url: `file:${dbFile}` });
  return {
    client,
    async close() {
      client.close();
      await removeDir(dir);
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

/** The origin_id migration is the last inlined entry. */
const ORIGIN_ID_MIGRATION_INDEX = MIGRATIONS.length - 1;

/** Exec one inlined migration's statements against a raw connection. */
async function applyMigration(client: Client, index: number): Promise<void> {
  const m = MIGRATIONS[index];
  if (m === undefined) throw new Error(`no migration at index ${index}`);
  for (const stmt of m.sql) {
    const trimmed = stmt.trim();
    if (trimmed.length > 0) await client.execute(trimmed);
  }
}

/** Apply migrations `[0, uptoExclusive)` — i.e. the pre-origin_id schema. */
async function applyThrough(client: Client, uptoExclusive: number): Promise<void> {
  for (let i = 0; i < uptoExclusive; i++) await applyMigration(client, i);
}

/** Insert a legacy (pre-origin_id) workflow row carrying its id in metadata. */
async function insertLegacyWorkflow(
  client: Client,
  row: { id: string; origin: string; metadata: Record<string, unknown> },
): Promise<void> {
  await client.execute({
    sql:
      "INSERT INTO `workflows` (`id`, `brief`, `coordinator_agent`, `created_at`, `metadata`, `status`, `origin`) " +
      "VALUES (?, 'b', 'official/engineer', '2026-01-01T00:00:00.000Z', ?, 'running', ?)",
    args: [row.id, JSON.stringify(row.metadata), row.origin],
  });
}

describe("workflows origin_id migration: post-state", () => {
  it("creates the (origin, origin_id) composite partial index and drops the legacy schedule-id index", async () => {
    const orm = await openMigratedFileDb();
    try {
      const indexes = (await orm.client.execute("PRAGMA index_list('workflows')"))
        .rows as unknown as Array<{
        name: string;
        partial: number;
      }>;
      const pair = indexes.find((r) => r.name === "workflows_origin_pair_idx");
      expect(pair, "workflows_origin_pair_idx must exist post-migration").toBeDefined();
      expect(pair?.partial, "it is a partial index (WHERE origin_id IS NOT NULL)").toBe(1);

      const cols = (
        (await orm.client.execute("PRAGMA index_info('workflows_origin_pair_idx')"))
          .rows as unknown as Array<{
          name: string | null;
        }>
      ).map((r) => r.name);
      expect(cols).toEqual(["origin", "origin_id"]);

      const legacy = indexes.find((r) => r.name === "workflows_schedule_id_idx");
      expect(legacy, "workflows_schedule_id_idx must be dropped").toBeUndefined();
    } finally {
      await orm.close();
    }
  });
});

describe("workflows origin_id migration: backfill (pre → post)", () => {
  it("backfills scheduleId onto origin_id for schedule-origin rows; standalone stays NULL", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await applyThrough(client, ORIGIN_ID_MIGRATION_INDEX);

      await insertLegacyWorkflow(client, {
        id: "wf-sched",
        origin: "schedule",
        metadata: { scheduleId: "sched-7" },
      });
      await insertLegacyWorkflow(client, { id: "wf-std", origin: "standalone", metadata: {} });

      await applyMigration(client, ORIGIN_ID_MIGRATION_INDEX);

      const rows = (await client.execute("SELECT id, origin_id FROM `workflows` ORDER BY id ASC"))
        .rows as unknown as Array<{ id: string; origin_id: string | null }>;
      const byId = new Map(rows.map((r) => [r.id, r.origin_id]));
      expect(byId.get("wf-sched")).toBe("sched-7");
      expect(byId.get("wf-std")).toBeNull();
    } finally {
      client.close();
    }
  });

  it("aborts when a schedule-origin row cannot be backfilled (RAISE(FAIL) guard)", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await applyThrough(client, ORIGIN_ID_MIGRATION_INDEX);
      await insertLegacyWorkflow(client, { id: "wf-broken", origin: "schedule", metadata: {} });

      await expect(applyMigration(client, ORIGIN_ID_MIGRATION_INDEX)).rejects.toThrow(
        /backfill incomplete/,
      );
    } finally {
      client.close();
    }
  });
});

describe("workflows origin_id migration: idempotent rerun", () => {
  it("a second applyWorkflowMigrations is a no-op (journal-gated), not a double-apply error", async () => {
    const orm = await openMigratedFileDb();
    try {
      const before = (
        await orm.client.execute("SELECT count(*) AS n FROM __drizzle_migrations_workflow")
      ).rows[0] as unknown as { n: number };
      await expect(applyWorkflowMigrations(orm.client)).resolves.toBeUndefined();
      const after = (
        await orm.client.execute("SELECT count(*) AS n FROM __drizzle_migrations_workflow")
      ).rows[0] as unknown as { n: number };
      expect(after.n).toBe(before.n);
    } finally {
      await orm.close();
    }
  });
});
