/**
 * Integration tests proving the request-scoped transaction middleware
 * provides atomicity:
 *
 *   1. A throw inside a transaction rolls back ALL prior writes.
 *   2. Successful transaction commits ALL writes atomically.
 *
 * Uses a real file-backed SQLite DB (not :memory:) so WAL semantics
 * are exercised as they would be in production.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Windows WAL lock latency: the libsql client holds the WAL file
// briefly after close(). Increase hook timeout for the rm() retries.
vi.setConfig({ hookTimeout: 60_000 });

import {
  applyCatalogMigrations,
  type Db as CatalogDb,
  wrapClient as wrapCatalogClient,
} from "@glyphs-ai/catalog";
import { applyTaskMigrations } from "@glyphs-ai/task";

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
  catalogDb = wrapCatalogClient(client);
});

afterEach(async () => {
  try {
    client.close();
  } catch {
    // best-effort
  }
  // Best-effort cleanup; WAL locks on Windows can outlive the process.
  try {
    await new Promise((r) => setTimeout(r, 200));
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // Leaking a temp dir is acceptable in CI; WAL cleanup is not blocking.
  }
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
