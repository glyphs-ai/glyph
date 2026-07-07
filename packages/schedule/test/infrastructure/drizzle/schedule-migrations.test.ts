import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../../src/infrastructure/drizzle/schedule-db.js";
import { MIGRATIONS } from "../../../src/infrastructure/drizzle/schedule-migrations.js";

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

describe("schedules migrations inventory", () => {
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
      if (prev && curr) expect(curr.folderMillis).toBeGreaterThan(prev.folderMillis);
    }
  });

  it("keeps the byte-for-byte migration hashes stable", () => {
    expect(MIGRATIONS.map((m) => m.hash)).toEqual([
      "847cb575719821100520be326745001dcca596ae9ae839422c4b821ea75658c1",
      "19fe6665280e23e42ad0a6542b45bfe8b5c907882597f28d464f520efc4756bd",
    ]);
  });
});

describe("openDb / applyScheduleMigrations", () => {
  let dir: string;
  let dbFile: string;
  let raw: Client;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "schedule-mig-"));
    dbFile = join(dir, "workspace.db");
    const { close } = await openDb(dbFile);
    close();
    raw = createClient({ url: `file:${dbFile}` });
  });

  afterEach(async () => {
    raw.close();
    await removeDir(dir);
  });

  it("creates the schedules table", async () => {
    const rows = (
      await raw.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    ).rows as unknown as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("schedules");
  });

  it("schedules table has every documented column", async () => {
    const cols = (await raw.execute("PRAGMA table_info('schedules')")).rows as unknown as {
      name: string;
    }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "created_at",
        "enabled",
        "id",
        "last_fired_at",
        "name",
        "next_fire_at",
        "target_json",
        "target_kind",
        "trigger_expr",
        "trigger_kind",
        "trigger_tz",
        "updated_at",
      ].sort(),
    );
    expect(names).not.toContain("target_agent");
  });

  it("creates the three documented indexes including the functional partial target-agent index", async () => {
    const rows = (
      await raw.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    ).rows as unknown as { name: string; sql?: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("schedules_enabled_idx");
    expect(names).toContain("schedules_next_fire_idx");
    expect(names).toContain("schedules_target_agent_idx");
  });

  it("schedules_target_agent_idx is a functional partial index on json_extract(target_json,'$.agent')", async () => {
    const row = (
      await raw.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='schedules_target_agent_idx'",
      )
    ).rows[0] as { sql: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.sql).toMatch(/json_extract\(`?target_json`?,\s*'\$\.agent'\)/);
    expect(row?.sql).toMatch(/WHERE\s+`?target_kind`?\s*=\s*'task'/);
  });

  it("writes the journal table __drizzle_migrations_schedule", async () => {
    const rows = (
      await raw.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__drizzle%'",
      )
    ).rows as unknown as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("__drizzle_migrations_schedule");
  });
});
