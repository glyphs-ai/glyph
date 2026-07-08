import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../testing.js";

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

let dir: string;
let dbFile: string;
let raw: ReturnType<typeof createClient> | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-mig-"));
  dbFile = join(dir, "workspace.db");
});

afterEach(async () => {
  raw?.close();
  raw = undefined;
  await removeDir(dir);
});

describe("openTestDb / applyTaskMigrations", () => {
  it("creates the tasks table with the origin_id column and the task journal", async () => {
    const { close } = await openTestDb(dbFile);
    close();

    raw = createClient({ url: `file:${dbFile}` });
    try {
      const tables = (
        (await raw.execute("SELECT name FROM sqlite_master WHERE type='table'"))
          .rows as unknown as Array<{ name: string }>
      ).map((r) => (r as { name: string }).name);
      expect(tables).toContain("tasks");
      // Shared-lineage journal table — must be `task`, not `task`, so a DB
      // already migrated by @glyphs-ai/task is recognised and not re-applied.
      expect(tables).toContain("__drizzle_migrations_task");

      const columns = (
        (await raw.execute("PRAGMA table_info(tasks)")).rows as unknown as Array<{ name: string }>
      ).map((r) => (r as { name: string }).name);
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
      raw = undefined;
    }
  });

  it("is idempotent — reopening an already-migrated file does not throw", async () => {
    (await openTestDb(dbFile)).close();
    const reopened = await openTestDb(dbFile);
    reopened.close();
  });
});
