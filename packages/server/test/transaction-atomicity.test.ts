/**
 * Integration tests proving the request-scoped transaction middleware
 * (`packages/server/src/middleware/transaction.ts`) provides atomicity:
 *
 *   1. A throw inside a transaction rolls back ALL prior writes.
 *   2. Successful transaction commits ALL writes atomically.
 *
 * Lives in `server` (not `api`): it drives the merged catalog + task schema
 * over a single libsql client, mirroring how the middleware wraps each request
 * in one drizzle transaction spanning both packages' tables.
 *
 * Uses a real file-backed SQLite DB (not :memory:) so WAL semantics
 * are exercised as they would be in production.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyCatalogMigrations,
  type Db as CatalogDb,
  schema as catalogSchema,
} from "@glyphs-ai/catalog";
import { applyTaskMigrations, schema as taskSchema } from "@glyphs-ai/task";
import { type Client, createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmScratch } from "./_test-support.js";

let scratch: string;
let client: Client;
let catalogDb: CatalogDb;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-tx-test-"));
  const dbFile = path.join(scratch, "workspace.db");
  client = createClient({ url: `file:${dbFile}` });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await applyCatalogMigrations(client);
  await applyTaskMigrations(client);
  // Mirror production: one merged-schema drizzle handle over the shared
  // client. The cross-package writes below prove atomicity across the
  // catalog + task tables through this single handle.
  catalogDb = drizzle(client, { schema: { ...catalogSchema, ...taskSchema } });
});

afterEach(async () => {
  // Windows-safe teardown MUST stay wall-clock bounded. The server suite
  // runs test files in parallel forks, and the 300s+ catalog-sync suite
  // starves this fork so heavily that libsql's raw `client.close()` releases
  // the `workspace.db-wal` / `-shm` fd late. The follow-up `rm` then blocks
  // on the still-locked files *inside* a single syscall — past rmScratch's
  // own retry budget, which only spaces out *attempts*. Cap the whole
  // cleanup with a timer race (a CPU-scheduled timeout fires independently of
  // the lock-blocked rm) so the hook can never approach vitest's hookTimeout.
  // If cleanup outlives the budget we abandon it and leak the temp dir —
  // harmless: os.tmpdir is reaped and each test mkdtemps a fresh scratch.
  try {
    client.close();
  } catch {
    // best-effort
  }
  await Promise.race([rmScratch(scratch), new Promise((r) => setTimeout(r, 15_000))]);
});

describe("request-scoped transaction atomicity", () => {
  it("throw inside transaction rolls back all prior writes", async () => {
    const error = new Error("simulated use-case failure");
    try {
      await catalogDb.transaction(async (tx) => {
        // Insert an agent row through the tx handle.
        await tx.run(
          sql`INSERT INTO agents (fqn, origin, description, version, prereqs_ack, disabled_by_user, installed_at, updated_at) VALUES ('test/rollback', 'file:/tmp', 'x', '1.0.0', 0, 0, '2026-01-01', '2026-01-01')`,
        );
        // Verify the row is visible inside the tx.
        const inside = await tx.all(sql`SELECT COUNT(*) as cnt FROM agents`);
        expect(Number((inside[0] as Record<string, unknown>).cnt)).toBe(1);
        throw error;
      });
    } catch (e) {
      expect(e).toBe(error);
    }

    // After rollback: agent must NOT be persisted.
    const rows = await client.execute("SELECT COUNT(*) as cnt FROM agents");
    expect(Number(rows.rows[0]!.cnt)).toBe(0);
  });

  it("cross-package writes in one transaction are atomic (commit path)", async () => {
    // Write to both agents (catalog) and tasks (task) tables in one tx.
    await catalogDb.transaction(async (tx) => {
      await tx.run(
        sql`INSERT INTO agents (fqn, origin, description, version, prereqs_ack, disabled_by_user, installed_at, updated_at) VALUES ('test/committed', 'file:/tmp', 'x', '1.0.0', 0, 0, '2026-01-01', '2026-01-01')`,
      );
      await tx.run(
        sql`INSERT INTO tasks (id, agent, status, brief, origin, created_at, started_at, metadata) VALUES ('tid-1', 'test/committed', 'pending', 'cross-pkg', 'api', '2026-01-01', '2026-01-01', '{}')`,
      );
    });

    // Both writes committed atomically.
    const agentCount = await client.execute("SELECT COUNT(*) as cnt FROM agents");
    expect(Number(agentCount.rows[0]!.cnt)).toBe(1);
    const taskCount = await client.execute("SELECT COUNT(*) as cnt FROM tasks");
    expect(Number(taskCount.rows[0]!.cnt)).toBe(1);
  });

  it("cross-package writes roll back together on throw", async () => {
    const error = new Error("cross-pkg failure");
    try {
      await catalogDb.transaction(async (tx) => {
        await tx.run(
          sql`INSERT INTO agents (fqn, origin, description, version, prereqs_ack, disabled_by_user, installed_at, updated_at) VALUES ('test/rolled', 'file:/tmp', 'x', '1.0.0', 0, 0, '2026-01-01', '2026-01-01')`,
        );
        await tx.run(
          sql`INSERT INTO tasks (id, agent, status, brief, origin, created_at, started_at, metadata) VALUES ('tid-2', 'test/rolled', 'pending', 'will rollback', 'api', '2026-01-01', '2026-01-01', '{}')`,
        );
        throw error;
      });
    } catch (e) {
      expect(e).toBe(error);
    }

    // Neither persists — proves cross-package atomicity.
    const agentCount = await client.execute("SELECT COUNT(*) as cnt FROM agents");
    expect(Number(agentCount.rows[0]!.cnt)).toBe(0);
    const taskCount = await client.execute("SELECT COUNT(*) as cnt FROM tasks");
    expect(Number(taskCount.rows[0]!.cnt)).toBe(0);
  });
});
