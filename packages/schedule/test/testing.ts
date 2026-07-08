import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Db } from "../src/infrastructure/drizzle/schedule-db.js";
import * as schema from "../src/infrastructure/drizzle/schedule-db.js";
import { applyScheduleMigrations } from "../src/infrastructure/drizzle/schedule-migrations.js";

/**
 * Test-only DB opener. Applies PRAGMAs + migrations against a fresh
 * `:memory:` or file-backed libsql client. Production callers build their
 * client + drizzle handle in `packages/api/src/workspace-context.ts` and pass
 * it to `composeScheduleModule({ db })`; production PRAGMAs are set once
 * against the shared client there.
 *
 * On migration failure the client is closed before the error propagates: a
 * leaked handle would hold the WAL lock and break a retry from the same caller.
 */
export async function openTestDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyScheduleMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}

/**
 * Open an in-memory schedule DB for tests. Also surfaces the underlying libsql
 * client (`db.$client`) for the few migration/query-plan tests that issue raw
 * SQL. Caller closes via `.close()`.
 */
export async function openTestScheduleDb(): Promise<{
  db: Db;
  client: Client;
  close(): void;
}> {
  const { db, close } = await openTestDb(":memory:");
  const client = (db as unknown as { $client: Client }).$client;
  return { db, client, close };
}
