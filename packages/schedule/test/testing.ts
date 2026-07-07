import type { Client } from "@libsql/client";
import { type Db, openDb } from "../src/infrastructure/drizzle/schedule-db.js";

/**
 * Open an in-memory schedule DB for tests, reusing the production `openDb`
 * (WAL pragmas + migrations) so the test schema can't drift from production.
 * Also surfaces the underlying libsql client (`db.$client`) for the few
 * migration/query-plan tests that issue raw SQL. Caller closes via `.close()`.
 */
export async function openTestScheduleDb(): Promise<{
  db: Db;
  client: Client;
  close(): void;
}> {
  const { db, close } = await openDb(":memory:");
  const client = (db as unknown as { $client: Client }).$client;
  return { db, client, close };
}
