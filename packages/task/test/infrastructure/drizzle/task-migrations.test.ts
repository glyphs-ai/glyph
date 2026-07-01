import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../../src/infrastructure/drizzle/task-db.js";

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-mig-"));
  dbFile = join(dir, "workspace.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDb / applyTaskMigrations", () => {
  it("creates the tasks table with the origin_id column and the task journal", () => {
    const { close } = openDb(dbFile);
    close();

    const raw = new Database(dbFile);
    try {
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain("tasks");
      // Shared-lineage journal table — must be `task`, not `task`, so a DB
      // already migrated by @glyphs-ai/task is recognised and not re-applied.
      expect(tables).toContain("__drizzle_migrations_task");

      const columns = raw
        .prepare("PRAGMA table_info(tasks)")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(columns).toEqual(
        expect.arrayContaining([
          "id",
          "agent",
          "runtime",
          "status",
          "brief",
          "details",
          "origin",
          "origin_id",
          "created_at",
          "started_at",
          "ended_at",
          "success",
          "failure",
          "cancellation",
          "metadata",
        ]),
      );
    } finally {
      raw.close();
    }
  });

  it("is idempotent — reopening an already-migrated file does not throw", () => {
    openDb(dbFile).close();
    expect(() => openDb(dbFile).close()).not.toThrow();
  });
});
